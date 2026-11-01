(() => {
  "use strict";

  const config = window.APP_CONFIG ?? {};
  const configured = config.supabaseUrl?.startsWith("https://") && config.supabaseAnonKey?.length > 20;
  const screens = ["setup-screen", "login-screen", "password-reset-screen", "public-screen", "admin-app"];
  const isPasswordResetRoute = window.location.pathname.replace(/\/+$/, "") === "/reset-password";
  const titles = {
    dashboard: "Overview",
    cases: "Cases",
    links: "Evidence links",
    visits: "Visit activity",
    consents: "Consent records",
    sessions: "GPS sessions",
    evidence: "Evidence library",
    map: "Location records",
    audit: "Audit log"
  };
  let client;
  let chart;
  let map;
  let realtimeChannel;
  let currentView = "dashboard";
  let locationWatch;
  let activeLocationSession;
  let locationTrackingActive = false;
  let locationStopInProgress = false;
  let currentVisitId;
  let publicToken;
  let publicLink;
  let imageStream;
  let audioStream;
  let audioRecorder;
  let audioChunks = [];
  let imageCapture;
  let audioCapture;
  let imageConsentId;
  let audioConsentId;
  let recoverySessionActive = false;

  const byId = (id) => document.getElementById(id);
  const setScreen = (visibleId) => screens.forEach((id) => byId(id).classList.toggle("d-none", id !== visibleId));
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
  const formatDate = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
  const emptyRow = (colspan, message) => `<tr><td class="empty-state" colspan="${colspan}">${escapeHtml(message)}</td></tr>`;
  const applyTableFilters = (tableId, searchId, statusId, typeId) => {
    const query = searchId ? byId(searchId).value.trim().toLowerCase() : "";
    const status = statusId ? byId(statusId).value : "";
    const type = typeId ? byId(typeId).value : "";
    byId(tableId).querySelectorAll("tr[data-search]").forEach((row) => {
      const matchesQuery = !query || row.dataset.search.includes(query);
      const matchesStatus = !status || row.dataset.status === status;
      const matchesType = !type || row.dataset.type === type;
      row.hidden = !(matchesQuery && matchesStatus && matchesType);
    });
  };
  const toast = (message, type = "success") => {
    const item = document.createElement("div");
    item.className = `app-toast ${type}`;
    item.textContent = message;
    byId("toast-region").append(item);
    window.setTimeout(() => item.remove(), 4800);
  };
  const showPublicMessage = (title, message, icon = "bi-shield-exclamation") => {
    byId("public-content").innerHTML = `<span class="brand-mark mb-3"><i class="bi ${icon}"></i></span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`;
  };
  const getPublicToken = () => {
    const match = window.location.pathname.match(/\/evidence\/([^/]+)/);
    return match?.[1] ?? new URLSearchParams(window.location.search).get("token");
  };

  async function invoke(name, body = {}) {
    const requestBody = { ...body };
    if (publicToken && currentVisitId && !requestBody.token) requestBody.token = publicToken;
    const { data, error } = await client.functions.invoke(name, { body: requestBody });
    if (error) {
      let detail = error.message || "The secure backend request failed.";
      if (error.context?.json) {
        const response = await error.context.json().catch(() => null);
        if (response?.error) {
          detail = response.request_id
            ? `${response.error} (Reference: ${response.request_id})`
            : response.error;
        }
      }

      throw new Error(detail);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function start() {
    publicToken = getPublicToken();
    if (publicToken) {
      setScreen("public-screen");
      await initializePublicPage();
      return;
    }
    if (!configured || !window.supabase?.createClient) {
      setScreen("setup-screen");
      return;
    }
    client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
    });
    client.auth.onAuthStateChange((event, sessionState) => {
      if (event === "SIGNED_OUT") {
        window.setTimeout(() => {
          if (realtimeChannel) client.removeChannel(realtimeChannel);
          realtimeChannel = null;
        }, 0);
        setScreen("login-screen");
      }
      if (event === "PASSWORD_RECOVERY") {
        recoverySessionActive = true;
        showPasswordRecovery();
      }
      if (event === "SIGNED_IN" && sessionState?.user) {
        if (isPasswordResetRoute) return;
        window.setTimeout(() => {
          showAdmin(sessionState.user).catch((error) => toast(`Administrator workspace could not open: ${error.message}`, "error"));
        }, 0);
      }
    });
    const { data: { session }, error } = await client.auth.getSession();
    if (error) {
      setScreen("login-screen");
      toast(`Could not restore the sign-in session: ${error.message}`, "error");
      return;
    }
    if (isPasswordResetRoute) {
      setScreen("password-reset-screen");
      if (session && recoverySessionActive) {
        showPasswordRecovery();
      } else {
        byId("password-update-form").classList.add("d-none");
        byId("password-reset-message").textContent = "This recovery link is invalid, expired, or has already been used. Request a new link from the sign-in page.";
      }
      return;
    }
    if (!session) {
      setScreen("login-screen");
      return;
    }
    await showAdmin(session.user);
    window.addEventListener("hashchange", routeAdmin);
  }

  async function showAdmin(user) {
    const { data: profile, error } = await client.from("profiles").select("role,full_name").eq("id", user.id).maybeSingle();
    if (error) {
      setScreen("login-screen");
      toast(`Unable to verify administrator access: ${error.message}`, "error");
      return;
    }
    if (profile?.role !== "admin") {
      await client.auth.signOut();
      setScreen("login-screen");
      toast("This account is not authorized as an administrator.", "error");
      return;
    }
    byId("admin-email").textContent = profile.full_name || user.email || "Administrator";
    setScreen("admin-app");
    setupRealtime();
    routeAdmin();
    loadDashboard();
  }

  function setupRealtime() {
    if (realtimeChannel) return;
    realtimeChannel = client.channel("admin-workspace-updates");
    for (const table of ["cases", "generated_links", "visits", "consent_records", "location_sessions", "location_records", "evidence", "audit_logs"]) {
      realtimeChannel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        loadDashboard();
        if (currentView === "dashboard") return;
        if (currentView === "cases") loadCases();
        else if (currentView === "links") loadLinks();
        else if (currentView === "visits") loadVisits();
        else if (currentView === "consents") loadConsentRecords();
        else if (currentView === "sessions") loadLocationSessions();
        else if (currentView === "evidence") loadEvidence();
        else if (currentView === "map") loadMap();
        else if (currentView === "audit") loadAudit();
      });
    }
    realtimeChannel.subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        toast("Live updates are unavailable. Reload a page to refresh its records.", "error");
      }
    });
  }

  async function routeAdmin() {
    const view = (window.location.hash.slice(1) || "dashboard").split("/")[0];
    const activeView = titles[view] ? view : "dashboard";
    currentView = activeView;
    document.querySelectorAll(".content-view").forEach((section) => section.classList.toggle("d-none", section.id !== `view-${activeView}`));
    document.querySelectorAll(".side-nav a").forEach((link) => link.classList.toggle("active", link.dataset.view === activeView));
    byId("page-title").textContent = titles[activeView];
    byId("sidebar").classList.remove("open");
    if (activeView === "dashboard") await loadDashboard();
    if (activeView === "cases") await loadCases();
    if (activeView === "links") await loadLinks();
    if (activeView === "visits") await loadVisits();
    if (activeView === "consents") await loadConsentRecords();
    if (activeView === "sessions") await loadLocationSessions();
    if (activeView === "evidence") await loadEvidence();
    if (activeView === "map") await loadMap();
    if (activeView === "audit") await loadAudit();
  }

  async function loadDashboard() {
    if (!client) return;
    try {
      const [cases, links, visits, sessions, evidence, recentCases, recentVisits] = await Promise.all([
        client.from("cases").select("id", { count: "exact", head: true }),
        client.from("generated_links").select("id", { count: "exact", head: true }).eq("is_active", true),
        client.from("visits").select("id", { count: "exact", head: true }),
        client.from("location_sessions").select("id", { count: "exact", head: true }).eq("status", "active"),
        client.from("evidence").select("id", { count: "exact", head: true }),
        client.from("cases").select("id,title,case_reference,status,incident_date,created_at").is("archived_at", null).order("created_at", { ascending: false }).limit(5),
        client.from("visits").select("id,visited_at,cases(title)").gte("visited_at", new Date(Date.now() - 7 * 86400000).toISOString()).order("visited_at", { ascending: false }).limit(5000)
      ]);
      for (const result of [cases, links, visits, sessions, evidence, recentCases, recentVisits]) if (result.error) throw result.error;
      byId("stat-cases").textContent = String(cases.count ?? 0);
      byId("stat-links").textContent = String(links.count ?? 0);
      byId("stat-visits").textContent = String(visits.count ?? 0);
      byId("stat-sessions").textContent = String(sessions.count ?? 0);
      byId("stat-evidence").textContent = String(evidence.count ?? 0);
      byId("recent-cases").innerHTML = recentCases.data.length ? recentCases.data.map((item) => `<tr><td><strong>${escapeHtml(item.title)}</strong></td><td>${escapeHtml(item.case_reference)}</td><td>${statusPill(item.status)}</td><td>${escapeHtml(formatDate(item.incident_date))}</td><td>${escapeHtml(formatDate(item.created_at))}</td></tr>`).join("") : emptyRow(5, "No cases yet.");
      byId("recent-activity").innerHTML = recentVisits.data.length ? recentVisits.data.slice(0, 5).map((item) => `<div class="activity-item"><span class="activity-dot"><i class="bi bi-activity"></i></span><div><p>Evidence link visited${item.cases?.title ? ` · ${escapeHtml(item.cases.title)}` : ""}</p><small>${escapeHtml(formatDate(item.visited_at))}</small></div></div>`).join("") : '<p class="empty-state">No recorded visits yet.</p>';
      drawActivityChart(recentVisits.data);
    } catch (error) {
      toast(`Dashboard could not load: ${error.message}`, "error");
    }
  }

  function drawActivityChart(visits) {
    if (!window.Chart) return;
    const labels = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - index));
      return date.toLocaleDateString(undefined, { weekday: "short" });
    });
    const counts = Array(7).fill(0);
    for (const visit of visits) {
      const daysAgo = Math.floor((Date.now() - new Date(visit.visited_at).getTime()) / 86400000);
      if (daysAgo >= 0 && daysAgo < 7) counts[6 - daysAgo] += 1;
    }
    if (chart) chart.destroy();
    chart = new Chart(byId("activity-chart"), {
      type: "bar",
      data: { labels, datasets: [{ data: counts, backgroundColor: "#4b82eb", borderRadius: 5, maxBarThickness: 30 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "#eef1f5" } } } }
    });
  }

  function statusPill(status) {
    const value = String(status || "Open");
    const modifier = value === "Closed" ? "closed" : value === "Under Review" ? "review" : "";
    return `<span class="status-pill ${modifier}">${escapeHtml(value)}</span>`;
  }

  async function loadCases() {
    try {
      const { data, error } = await client.from("cases").select("id,title,case_reference,status,incident_date,updated_at,description").is("archived_at", null).order("updated_at", { ascending: false });
      if (error) throw error;
      byId("cases-table").innerHTML = data.length ? data.map((item) => `<tr data-search="${escapeHtml(`${item.title} ${item.case_reference}`.toLowerCase())}" data-status="${escapeHtml(item.status)}"><td><strong>${escapeHtml(item.title)}</strong></td><td>${escapeHtml(item.case_reference)}</td><td><select class="form-select form-select-sm case-status" data-id="${escapeHtml(item.id)}" aria-label="Status for ${escapeHtml(item.title)}">${["Open", "Under Review", "Evidence Collected", "Submitted to Police", "Closed"].map((status) => `<option ${status === item.status ? "selected" : ""}>${status}</option>`).join("")}</select></td><td>${escapeHtml(formatDate(item.incident_date))}</td><td>${escapeHtml(formatDate(item.updated_at))}</td><td class="text-nowrap"><button class="table-action edit-case me-1" data-id="${escapeHtml(item.id)}" type="button">Edit</button><button class="table-action case-report me-1" data-id="${escapeHtml(item.id)}" type="button"><i class="bi bi-file-earmark-pdf"></i> Report</button><button class="table-action archive-case" data-id="${escapeHtml(item.id)}" type="button">Archive</button></td></tr>`).join("") : emptyRow(6, "Create a case to get started.");
      document.querySelectorAll(".case-status").forEach((select) => select.addEventListener("change", updateCaseStatus));
      document.querySelectorAll(".case-report").forEach((button) => button.addEventListener("click", () => generateReport(button.dataset.id)));
      document.querySelectorAll(".edit-case").forEach((button) => button.addEventListener("click", () => editCase(button.dataset.id, data)));
      document.querySelectorAll(".archive-case").forEach((button) => button.addEventListener("click", archiveCase));
      const { data: allCases, error: allCasesError } = await client.from("cases").select("id,title,case_reference").is("archived_at", null).order("created_at", { ascending: false });
      if (allCasesError) throw allCasesError;
      const select = document.querySelector('#link-form select[name="case_id"]');
      if (select) select.innerHTML = allCases.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.case_reference)} — ${escapeHtml(item.title)}</option>`).join("");
      applyTableFilters("cases-table", "case-search", "case-status-filter");
    } catch (error) { toast(`Cases could not load: ${error.message}`, "error"); }
  }

  async function updateCaseStatus(event) {
    const { error } = await client.from("cases").update({ status: event.currentTarget.value }).eq("id", event.currentTarget.dataset.id);
    if (error) toast(`Case status was not updated: ${error.message}`, "error");
    else { toast("Case status updated."); loadDashboard(); }
  }

  async function loadLinks() {
    try {
      const { data, error } = await client.from("generated_links").select("id,case_id,description,is_active,expires_at,created_at,cases(title,case_reference)").order("created_at", { ascending: false });
      if (error) throw error;
      byId("links-table").innerHTML = data.length ? data.map((item) => {
        const expired = item.expires_at && new Date(item.expires_at) <= new Date();
        return `<tr><td><strong>${escapeHtml(item.cases?.case_reference || "—")}</strong><br>${escapeHtml(item.cases?.title || "Case unavailable")}</td><td>${escapeHtml(item.description)}</td><td><span class="status-pill ${!item.is_active ? "inactive" : expired ? "expired" : ""}">${!item.is_active ? "Inactive" : expired ? "Expired" : "Active"}</span></td><td>${escapeHtml(formatDate(item.expires_at))}</td><td>${escapeHtml(formatDate(item.created_at))}</td><td><button class="table-action toggle-link" data-id="${escapeHtml(item.id)}" data-active="${String(item.is_active)}" type="button">${item.is_active ? "Deactivate" : "Activate"}</button></td></tr>`;
      }).join("") : emptyRow(6, "No evidence links have been generated.");
      document.querySelectorAll(".toggle-link").forEach((button) => button.addEventListener("click", toggleLink));
    } catch (error) { toast(`Evidence links could not load: ${error.message}`, "error"); }
  }

  async function toggleLink(event) {
    const active = event.currentTarget.dataset.active !== "true";
    try {
      await invoke("manage-evidence-link", { link_id: event.currentTarget.dataset.id, is_active: active });
      toast(active ? "Evidence link activated." : "Evidence link deactivated."); loadLinks();
    } catch (error) { toast(`Link status was not changed: ${error.message}`, "error"); }
  }

  async function loadVisits() {
    try {
      const { data, error } = await client.from("visits").select("id,visited_at,ip_address,browser,operating_system,device_category,user_agent,estimated_country,estimated_region,estimated_city,cases(title,case_reference)").order("visited_at", { ascending: false }).limit(250);
      if (error) throw error;
      byId("visits-table").innerHTML = data.length ? data.map((item) => {
        const searchText = `${item.cases?.case_reference || ""} ${item.cases?.title || ""} ${item.ip_address || ""} ${item.estimated_city || ""} ${item.estimated_region || ""} ${item.estimated_country || ""} ${item.browser || ""} ${item.operating_system || ""}`.toLowerCase();
        return `<tr data-search="${escapeHtml(searchText)}"><td>${escapeHtml(formatDate(item.visited_at))}</td><td>${escapeHtml(item.cases?.case_reference || "—")}<br>${escapeHtml(item.cases?.title || "")}</td><td>${escapeHtml(item.ip_address || "Unavailable")}</td><td>${escapeHtml([item.estimated_city, item.estimated_region, item.estimated_country].filter(Boolean).join(", ") || "Unavailable")} <small class="d-block text-secondary">Estimate only</small></td><td>${escapeHtml([item.browser, item.operating_system, item.device_category].filter(Boolean).join(" · ") || "Unavailable")}<button class="table-action visit-details d-block mt-2" data-id="${escapeHtml(item.id)}" type="button">Details</button></td></tr>`;
      }).join("") : emptyRow(5, "No visit records.");
      document.querySelectorAll(".visit-details").forEach((button) => button.addEventListener("click", () => showVisitDetails(button.dataset.id, data)));
      applyTableFilters("visits-table", "visit-search");
    } catch (error) { toast(`Visit records could not load: ${error.message}`, "error"); }
  }

  async function loadEvidence() {
    try {
      const { data, error } = await client.from("evidence").select("id,case_id,evidence_type,storage_path,storage_bucket,mime_type,file_size,integrity_hash,statement_text,collected_at,cases(title,case_reference)").order("collected_at", { ascending: false }).limit(500);
      if (error) throw error;
      byId("evidence-table").innerHTML = data.length ? data.map((item) => {
        const searchText = `${item.cases?.case_reference || ""} ${item.cases?.title || ""} ${item.evidence_type} ${item.integrity_hash || ""}`.toLowerCase();
        return `<tr data-search="${escapeHtml(searchText)}" data-type="${escapeHtml(item.evidence_type)}"><td>${escapeHtml(formatDate(item.collected_at))}</td><td><strong>${escapeHtml(item.cases?.case_reference || "—")}</strong><br>${escapeHtml(item.cases?.title || "")}</td><td>${escapeHtml(item.evidence_type)}</td><td>${escapeHtml(item.mime_type || (item.statement_text ? "Written statement" : "Record"))}<br>${item.file_size ? `${(item.file_size / 1024).toFixed(1)} KB` : "—"}</td><td><code>${escapeHtml(item.integrity_hash || "Not applicable")}</code></td><td class="text-nowrap">${item.storage_path ? `<button class="table-action preview-evidence me-1" data-id="${escapeHtml(item.id)}" type="button">Preview</button><button class="table-action download-evidence" data-bucket="${escapeHtml(item.storage_bucket)}" data-path="${escapeHtml(item.storage_path)}" type="button"><i class="bi bi-download"></i> Download</button>` : item.statement_text ? `<button class="table-action preview-evidence" data-id="${escapeHtml(item.id)}" type="button">Read statement</button>` : ""}</td></tr>`;
      }).join("") : emptyRow(6, "No evidence has been submitted.");
      document.querySelectorAll(".download-evidence").forEach((button) => button.addEventListener("click", downloadEvidence));
      document.querySelectorAll(".preview-evidence").forEach((button) => button.addEventListener("click", () => previewEvidence(button.dataset.id, data)));
      applyTableFilters("evidence-table", "evidence-search", null, "evidence-type-filter");
    } catch (error) { toast(`Evidence could not load: ${error.message}`, "error"); }
  }

  async function previewEvidence(evidenceId, records) {
    const record = records.find((item) => item.id === evidenceId);
    if (!record) { toast("Evidence record was not found.", "error"); return; }
    if (record.statement_text) {
      byId("statement-content").textContent = record.statement_text;
      bootstrap.Modal.getOrCreateInstance(byId("statement-modal")).show();
      return;
    }
    if (!record.storage_path || !record.storage_bucket) { toast("This evidence record has no stored file.", "error"); return; }
    const { data, error } = await client.storage.from(record.storage_bucket).createSignedUrl(record.storage_path, 60);
    if (error) { toast(`Evidence preview could not be opened: ${error.message}`, "error"); return; }
    const opened = window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    if (!opened) toast("The browser blocked the preview window. Allow pop-ups and retry.", "error");
  }

  function showVisitDetails(visitId, visits) {
    const visit = visits.find((record) => record.id === visitId);
    if (!visit) { toast("Visit record was not found.", "error"); return; }
    const location = [visit.estimated_city, visit.estimated_region, visit.estimated_country].filter(Boolean).join(", ");
    const values = [
      ["Visit timestamp", formatDate(visit.visited_at)],
      ["Case", `${visit.cases?.case_reference || "—"} ${visit.cases?.title || ""}`],
      ["IP address", visit.ip_address || "Unavailable"],
      ["Estimated network location", location || "Unavailable (estimate only)"],
      ["Browser", visit.browser || "Unknown"],
      ["Operating system", visit.operating_system || "Unknown"],
      ["Device category", visit.device_category || "Unknown"],
      ["User agent", visit.user_agent || "Unavailable"],
      ["Visit record ID", visit.id]
    ];
    byId("visit-details-content").innerHTML = `<p class="form-hint">Network location is an estimate. Technical metadata does not independently identify a person.</p><dl class="details-list">${values.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>`;
    bootstrap.Modal.getOrCreateInstance(byId("visit-details-modal")).show();
  }

  async function downloadEvidence(event) {
    const { data, error } = await client.storage.from(event.currentTarget.dataset.bucket).createSignedUrl(event.currentTarget.dataset.path, 60, { download: true });
    if (error) toast(`Secure download could not be created: ${error.message}`, "error");
    else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function loadMap() {
    try {
      const [gps, visits] = await Promise.all([
        client.from("location_records").select("latitude,longitude,accuracy,recorded_at").limit(1000),
        client.from("visits").select("estimated_latitude,estimated_longitude,estimated_city,estimated_region,estimated_country,visited_at,cases(title,case_reference)").not("estimated_latitude", "is", null).not("estimated_longitude", "is", null).limit(1000)
      ]);
      if (gps.error) throw gps.error;
      if (visits.error) throw visits.error;
      if (!window.L) throw new Error("The map library did not load.");
      if (!map) {
        map = L.map("location-map").setView([20, 0], 2);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
      }
      map.eachLayer((layer) => { if (layer instanceof L.CircleMarker) map.removeLayer(layer); });
      const points = [];
      for (const row of gps.data) {
        const lat = Number(row.latitude); const lng = Number(row.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        points.push([lat, lng]);
        L.circleMarker([lat, lng], { radius: 7, color: "#2366df", fillColor: "#2366df", fillOpacity: .8 }).addTo(map).bindPopup(`<strong>Consented GPS</strong><br>${escapeHtml(formatDate(row.recorded_at))}<br>Accuracy: ${escapeHtml(row.accuracy)} m`);
      }
      for (const row of visits.data) {
        const lat = Number(row.estimated_latitude); const lng = Number(row.estimated_longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        points.push([lat, lng]);
        L.circleMarker([lat, lng], { radius: 7, color: "#d88813", fillColor: "#edae47", fillOpacity: .8 }).addTo(map).bindPopup(`<strong>Estimated IP location</strong><br>${escapeHtml([row.estimated_city, row.estimated_region, row.estimated_country].filter(Boolean).join(", ") || "Approximate location")}<br>${escapeHtml(formatDate(row.visited_at))}<br><small>Estimate only</small>`);
      }
      if (points.length) map.fitBounds(points, { padding: [28, 28], maxZoom: 11 });
      window.setTimeout(() => map.invalidateSize(), 100);
    } catch (error) { toast(`Location map could not load: ${error.message}`, "error"); }
  }

  async function loadAudit() {
    try {
      const { data, error } = await client.from("audit_logs").select("id,admin_id,action,entity_type,entity_id,created_at").order("created_at", { ascending: false }).limit(300);
      if (error) throw error;
      byId("audit-table").innerHTML = data.length ? data.map((item) => `<tr><td>${escapeHtml(formatDate(item.created_at))}</td><td>${escapeHtml(item.admin_id)}</td><td>${escapeHtml(item.action)}</td><td>${escapeHtml(`${item.entity_type || ""} ${item.entity_id || ""}`)}</td></tr>`).join("") : emptyRow(4, "No administrative actions recorded yet.");
    } catch (error) { toast(`Audit log could not load: ${error.message}`, "error"); }
  }

  async function loadConsentRecords() {
    try {
      const { data: records, error } = await client.from("consent_records")
        .select("id,visit_id,permission_type,consent_status,purpose,consent_timestamp,revoked_at")
        .order("consent_timestamp", { ascending: false }).limit(500);
      if (error) throw error;
      const visitIds = [...new Set(records.map((record) => record.visit_id))];
      const { data: visits, error: visitsError } = visitIds.length
        ? await client.from("visits").select("id,case_id").in("id", visitIds)
        : { data: [], error: null };
      if (visitsError) throw visitsError;
      const caseIds = [...new Set((visits || []).map((visit) => visit.case_id))];
      const { data: cases, error: casesError } = caseIds.length
        ? await client.from("cases").select("id,title,case_reference").in("id", caseIds)
        : { data: [], error: null };
      if (casesError) throw casesError;
      const visitsById = new Map((visits || []).map((visit) => [visit.id, visit]));
      const casesById = new Map((cases || []).map((item) => [item.id, item]));
      byId("consents-table").innerHTML = records.length ? records.map((record) => {
        const caseRecord = casesById.get(visitsById.get(record.visit_id)?.case_id);
        const badge = record.consent_status === "granted" ? "status-pill" : record.consent_status === "denied" ? "status-pill review" : "status-pill inactive";
        return `<tr><td>${escapeHtml(formatDate(record.consent_timestamp))}</td><td>${escapeHtml(caseRecord?.case_reference || "—")}<br>${escapeHtml(caseRecord?.title || "")}</td><td><code>${escapeHtml(record.visit_id)}</code></td><td>${escapeHtml(record.permission_type)}</td><td><span class="${badge}">${escapeHtml(record.consent_status)}</span></td><td>${escapeHtml(record.purpose)}</td><td>${escapeHtml(formatDate(record.revoked_at))}</td></tr>`;
      }).join("") : emptyRow(7, "No consent records.");
    } catch (error) { toast(`Consent records could not load: ${error.message}`, "error"); }
  }

  async function loadLocationSessions() {
    try {
      const { data: sessions, error } = await client.from("location_sessions")
        .select("id,visit_id,status,started_at,ended_at").order("started_at", { ascending: false }).limit(500);
      if (error) throw error;
      const visitIds = [...new Set(sessions.map((session) => session.visit_id))];
      const { data: visits, error: visitsError } = visitIds.length
        ? await client.from("visits").select("id,case_id").in("id", visitIds)
        : { data: [], error: null };
      if (visitsError) throw visitsError;
      const caseIds = [...new Set((visits || []).map((visit) => visit.case_id))];
      const { data: cases, error: casesError } = caseIds.length
        ? await client.from("cases").select("id,title,case_reference").in("id", caseIds)
        : { data: [], error: null };
      if (casesError) throw casesError;
      const { data: locations, error: locationsError } = sessions.length
        ? await client.from("location_records").select("session_id").in("session_id", sessions.map((session) => session.id)).limit(10000)
        : { data: [], error: null };
      if (locationsError) throw locationsError;
      const visitsById = new Map((visits || []).map((visit) => [visit.id, visit]));
      const casesById = new Map((cases || []).map((item) => [item.id, item]));
      const counts = new Map();
      for (const location of locations || []) counts.set(location.session_id, (counts.get(location.session_id) || 0) + 1);
      byId("sessions-table").innerHTML = sessions.length ? sessions.map((session) => {
        const caseRecord = casesById.get(visitsById.get(session.visit_id)?.case_id);
        const badge = session.status === "active" ? "status-pill review" : "status-pill inactive";
        return `<tr><td>${escapeHtml(formatDate(session.started_at))}</td><td>${escapeHtml(caseRecord?.case_reference || "—")}<br>${escapeHtml(caseRecord?.title || "")}</td><td><code>${escapeHtml(session.visit_id)}</code></td><td><span class="${badge}">${escapeHtml(session.status)}</span></td><td>${escapeHtml(formatDate(session.ended_at))}</td><td>${counts.get(session.id) || 0}</td></tr>`;
      }).join("") : emptyRow(6, "No GPS sessions have been started.");
    } catch (error) { toast(`GPS sessions could not load: ${error.message}`, "error"); }
  }

  function editCase(caseId, records) {
    const record = records.find((item) => item.id === caseId);
    if (!record) { toast("The selected case could not be found.", "error"); return; }
    const form = byId("case-form");
    form.elements.id.value = record.id;
    form.elements.title.value = record.title;
    form.elements.case_reference.value = record.case_reference;
    form.elements.status.value = record.status;
    form.elements.description.value = record.description || "";
    form.elements.incident_date.value = record.incident_date ? new Date(record.incident_date).toISOString().slice(0, 16) : "";
    byId("case-modal-title").textContent = "Edit case";
    bootstrap.Modal.getOrCreateInstance(byId("case-modal")).show();
  }

  async function archiveCase(event) {
    const caseId = event.currentTarget.dataset.id;
    if (!window.confirm("Archive this case? It will disappear from active lists, but its evidence and links will be retained.")) return;
    const { error } = await client.from("cases").update({ archived_at: new Date().toISOString() }).eq("id", caseId);
    if (error) { toast(`Case could not be archived: ${error.message}`, "error"); return; }
    toast("Case archived. Existing links remain revocable from the links page.");
    await loadCases(); await loadDashboard();
  }

  async function createCase(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const { data: { user } } = await client.auth.getUser();
    if (!values.id && !user) { toast("Your administrator session has expired. Sign in again.", "error"); return; }
    const record = {
      title: String(values.title).trim(),
      case_reference: String(values.case_reference).trim(),
      incident_date: values.incident_date ? new Date(values.incident_date).toISOString() : null,
      status: values.status,
      description: String(values.description || "").trim()
    };
    const result = values.id
      ? await client.from("cases").update(record).eq("id", values.id)
      : await client.from("cases").insert({ ...record, created_by: user.id });
    const { error } = result;
    if (error) { toast(`Case could not be saved: ${error.message}`, "error"); return; }
    bootstrap.Modal.getOrCreateInstance(byId("case-modal")).hide();
    form.reset();
    byId("case-modal-title").textContent = "Create a case";
    toast(values.id ? "Case updated." : "Case created.");
    loadCases(); loadDashboard();
  }

  async function createEvidenceLink(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    try {
      const data = await invoke("generate-evidence-link", {
        case_id: values.case_id,
        description: String(values.description).trim(),
        expires_at: values.expires_at ? new Date(values.expires_at).toISOString() : null
      });
      const linkUrl = new URL(`/evidence/${encodeURIComponent(data.token)}`, window.location.origin).toString();
      byId("created-link-url").value = linkUrl;
      bootstrap.Modal.getOrCreateInstance(byId("link-modal")).hide();
      bootstrap.Modal.getOrCreateInstance(byId("link-created-modal")).show();
      form.reset();
      toast("Evidence link created. Copy it now; the token is not stored in readable form.");
      loadLinks();
    } catch (error) { toast(`Evidence link could not be created: ${error.message}`, "error"); }
  }

  async function generateReport(caseId) {
    try {
      const report = await invoke("generate-police-report", { case_id: caseId });
      const caseRecord = report.case;
      if (!window.jspdf?.jsPDF) throw new Error("PDF library is unavailable.");
      const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
      const left = 18;
      let y = 20;
      const line = (label, text) => {
        const lines = doc.splitTextToSize(`${label}: ${text || "Not recorded"}`, 174);
        if (y + lines.length * 5 > 278) { doc.addPage(); y = 20; }
        doc.text(lines, left, y); y += lines.length * 5 + 2;
      };
      const heading = (value) => {
        if (y > 270) { doc.addPage(); y = 20; }
        y += 3; doc.setFontSize(13); doc.text(value, left, y); y += 7; doc.setFontSize(9);
      };
      doc.setFontSize(18); doc.text("Incident Evidence Summary", left, y); y += 10;
      doc.setFontSize(10);
      line("Case reference", caseRecord.case_reference);
      line("Case title", caseRecord.title);
      line("Prepared by", caseRecord.creator_name);
      line("Report generated", report.generated_at);
      line("Incident date", caseRecord.incident_date ? new Date(caseRecord.incident_date).toISOString() : "Not recorded");
      line("Status", caseRecord.status);
      line("Description", caseRecord.description);
      heading("Link visits");
      for (const visit of report.visits) {
        line(new Date(visit.visited_at).toISOString(), `${visit.ip_address || "IP unavailable"} / ${[visit.browser, visit.operating_system, visit.device_category].filter(Boolean).join(" / ")}`);
        line("Estimated network location", [visit.estimated_city, visit.estimated_region, visit.estimated_country].filter(Boolean).join(", ") || "Unavailable; estimate only");
      }
      heading("Consent records");
      for (const item of report.consents) line(`${item.permission_type} / ${item.consent_status}`, `${item.consent_timestamp}${item.revoked_at ? ` / revoked ${item.revoked_at}` : ""}`);
      heading("GPS records");
      for (const item of report.locations) line(`${item.recorded_at} / ${item.id}`, `${item.latitude}, ${item.longitude} / accuracy ${item.accuracy} m`);
      heading("Submitted evidence");
      for (const item of report.evidence) line(`${item.evidence_type} / ${item.id}`, `${item.collected_at} / ${item.integrity_hash || "No file hash"}`);
      heading("Generated links");
      for (const item of report.links) line(item.description, `${item.is_active ? "Active" : "Inactive"} / expires ${item.expires_at || "not set"}`);
      heading("Accuracy and interpretation limitations");
      for (const item of report.limitations) line("-", item);
      for (let page = 1; page <= doc.getNumberOfPages(); page += 1) {
        doc.setPage(page);
        doc.setFontSize(8); doc.setTextColor(110);
        doc.text(`Generated ${report.generated_at} / Page ${page} of ${doc.getNumberOfPages()}`, left, 289);
      }
      doc.save(`${caseRecord.case_reference}-evidence-report.pdf`);
    } catch (error) { toast(`Report could not be generated: ${error.message}`, "error"); }
  }

  async function initializePublicPage() {
    if (!configured || !window.supabase?.createClient) {
      showPublicMessage("Service unavailable", "The evidence submission service has not been configured. No device permissions were requested.");
      return;
    }
    client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    try {
      publicLink = await invoke("validate-evidence-link", { token: publicToken });
      if (!publicLink?.valid) throw new Error("This evidence link is invalid, inactive, or expired.");
      renderPublicLanding();
    } catch (error) {
      showPublicMessage("Link unavailable", error.message || "This link is invalid or expired.");
    }
  }

  function renderPublicLanding() {
    const label = publicLink.case_title ? `Case: ${publicLink.case_title}` : "Authorized incident evidence submission";
    byId("public-content").innerHTML = `
      <p class="eyebrow">TRANSPARENT SUBMISSION</p>
      <h1>Share information or evidence</h1>
      <p>${escapeHtml(label)}</p>
      <p><strong>Link purpose:</strong> ${escapeHtml(publicLink.description || "Voluntary incident information submission")}</p>
      <p>This page is for voluntarily submitting information to an authorized incident investigation. You can decline every optional permission and still submit text-only information.</p>
      <div class="consent-notice">
        <h2><i class="bi bi-info-circle me-2"></i>What happens when you continue</h2>
        <p class="mb-0">After you continue, the system records the time of this visit, your network IP address (as received by the server), browser and device metadata, and may estimate a network location. These records are visible to authorized administrators and are not proof of identity. GPS, camera, microphone, and uploaded files are separate, optional actions. No device sensor is activated in the background.</p>
      </div>
      <div class="d-flex flex-wrap gap-2"><button id="continue-public" class="btn btn-primary" type="button">Continue to submission</button><button id="decline-public" class="btn btn-outline-secondary" type="button">Leave this page</button></div>`;
    byId("continue-public").addEventListener("click", recordPublicVisit);
    byId("decline-public").addEventListener("click", () => { window.location.replace("/"); });
  }

  async function recordPublicVisit() {
    const button = byId("continue-public");
    button.disabled = true;
    button.textContent = "Recording visit…";
    try {
      const result = await invoke("record-visit", { token: publicToken, user_agent: navigator.userAgent, referrer: document.referrer || null });
      currentVisitId = result.visit_id;
      renderEvidenceSubmission();
    } catch (error) {
      button.disabled = false;
      button.textContent = "Continue to submission";
      toast(`Visit could not be recorded: ${error.message}`, "error");
    }
  }

  function renderEvidenceSubmission() {
    byId("public-content").innerHTML = `
      <p class="eyebrow">OPTIONAL EVIDENCE</p>
      <h1>Choose what you want to share</h1>
      <p>No location, camera, or microphone permission is requested until you select that feature. Stop at any time; only items you confirm are uploaded.</p>
      <label class="form-label w-100">Optional written statement<textarea id="public-note" class="form-control" rows="4" maxlength="5000" placeholder="Enter information you choose to share"></textarea></label>
      <div class="permission-grid">
        <article class="permission-card"><i class="bi bi-geo-alt"></i><h3>Location</h3><p>Request a visible, active GPS session through your browser. You can stop sharing at any time.</p><button id="start-location" class="btn btn-outline-primary btn-sm" type="button">Share location</button><div id="location-status" class="location-status d-none" aria-live="polite"></div></article>
        <article class="permission-card"><i class="bi bi-camera"></i><h3>Photograph</h3><p>Open your camera only after you press the button. Review the image before submission.</p><button id="open-camera" class="btn btn-outline-primary btn-sm" type="button">Open camera</button><div id="camera-area"></div></article>
        <article class="permission-card"><i class="bi bi-mic"></i><h3>Audio recording</h3><p>Start and stop the recording yourself. Listen before you decide whether to submit it.</p><button id="start-audio" class="btn btn-outline-primary btn-sm" type="button">Start recording</button><div id="audio-area"></div></article>
      </div>
      <div class="d-flex flex-wrap gap-2 mt-3"><button id="submit-note" class="btn btn-primary" type="button">Submit written statement</button><button id="finish-public" class="btn btn-outline-secondary" type="button">Finish and leave</button></div>`;
    byId("start-location").addEventListener("click", startLocation);
    byId("open-camera").addEventListener("click", openCamera);
    byId("start-audio").addEventListener("click", startAudio);
    byId("submit-note").addEventListener("click", submitNote);
    byId("finish-public").addEventListener("click", endPublicSession);
  }

  function errorMessage(error) {
    if (error?.code === 1) return "Permission was denied. No data was collected.";
    if (error?.code === 2) return "Your device could not determine a location.";
    if (error?.code === 3) return "The location request timed out.";
    return error?.message || "The requested device feature is unavailable.";
  }

  async function startLocation() {
    if (!navigator.geolocation) { toast("This browser does not support location.", "error"); return; }
    if (!currentVisitId) {
      console.error(JSON.stringify({ operation: "start-location-session", success: false, code: "MISSING_VISIT_ID" }));
      toast("Location cannot start because this submission has no recorded visit. Restart the submission and try again.", "error");
      return;
    }
    const status = byId("location-status");
    status.classList.remove("d-none");
    status.textContent = "Requesting your location. Your browser will ask for permission.";
    byId("start-location").disabled = true;
    const savePosition = async (positionUpdate) => {
      if (!locationTrackingActive || locationStopInProgress || !activeLocationSession) return;
      const visitId = currentVisitId;
      const sessionId = activeLocationSession;
      if (!visitId) {
        console.error(JSON.stringify({ operation: "save-location-record", success: false, code: "MISSING_VISIT_ID" }));
        toast("Location update could not be saved because this submission has no visit record.", "error");
        return;
      }
      try {
        await invoke("save-location-record", {
          visit_id: visitId,
          session_id: sessionId,
          latitude: positionUpdate.coords.latitude,
          longitude: positionUpdate.coords.longitude,
          accuracy: positionUpdate.coords.accuracy
        });
        if (!locationTrackingActive || locationStopInProgress || activeLocationSession !== sessionId) return;
        status.firstChild.textContent = `Location sharing is active. Last update ${new Date(positionUpdate.timestamp).toLocaleTimeString()} (±${Math.round(positionUpdate.coords.accuracy)} m). `;
      } catch (error) {
        if (/inactive|expired/i.test(error.message)) {
          await stopLocation("The evidence link is no longer active. Location sharing has stopped.");
        } else {
          console.error(JSON.stringify({ operation: "save-location-record", success: false, message: error.message }));
          toast(`Location update could not be saved: ${error.message}`, "error");
        }
      }
    };
    navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        const consent = await invoke("create-consent-record", {
          visit_id: currentVisitId,
          permission_type: "location",
          consent_status: "granted",
          purpose: "User-initiated visible GPS session"
        });
        const session = await invoke("start-location-session", { visit_id: currentVisitId, consent_id: consent.consent_id });
        activeLocationSession = session.session_id;
        locationTrackingActive = true;
        status.textContent = "Location sharing is active. Select Stop sharing at any time.";
        status.insertAdjacentHTML("beforeend", ' <button id="stop-location" class="btn btn-sm btn-outline-danger mt-2" type="button">Stop sharing</button>');
        byId("stop-location").addEventListener("click", () => stopLocation());
        await savePosition(position);
        if (locationStopInProgress || !activeLocationSession) return;
        locationWatch = navigator.geolocation.watchPosition(savePosition, async (error) => {
          await stopLocation(`Location sharing ended: ${errorMessage(error)}`);
        }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
      } catch (error) {
        byId("start-location").disabled = false;
        status.textContent = error.message;
        toast(`Location session could not start: ${error.message}`, "error");
      }
    }, async (error) => {
      status.textContent = errorMessage(error);
      byId("start-location").disabled = false;
      try {
        await invoke("create-consent-record", {
          visit_id: currentVisitId,
          permission_type: "location",
          consent_status: "denied",
          purpose: "User declined or browser denied a location request"
        });
      } catch (failure) { toast(`Could not record the location permission result: ${failure.message}`, "error"); }
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
  }

  async function stopLocation(message = "Location sharing has stopped.") {
    if (locationStopInProgress) return;
    locationStopInProgress = true;
    locationTrackingActive = false;
    if (locationWatch !== undefined) navigator.geolocation.clearWatch(locationWatch);
    locationWatch = undefined;
    const status = byId("location-status");
    const stopButton = byId("stop-location");
    if (stopButton) stopButton.disabled = true;
    if (activeLocationSession) {
      const visitId = currentVisitId;
      const sessionId = activeLocationSession;
      if (!visitId) {
        console.error(JSON.stringify({ operation: "end-location-session", success: false, code: "MISSING_VISIT_ID" }));
        if (status?.firstChild) {
          status.firstChild.textContent = "Browser tracking stopped, but the session cannot be finalized without its visit record. ";
        }
        if (stopButton) {
          stopButton.disabled = false;
          stopButton.textContent = "Retry stop";
        }
        toast("Could not close the location session because this submission has no visit record.", "error");
        locationStopInProgress = false;
        return;
      }
      try {
        await invoke("end-location-session", { visit_id: visitId, session_id: sessionId });
      } catch (error) {
        console.error(JSON.stringify({ operation: "end-location-session", success: false, message: error.message }));
        if (status?.firstChild) {
          status.firstChild.textContent = `Browser tracking stopped, but the session could not be finalized: ${error.message} `;
        }
        if (stopButton) {
          stopButton.disabled = false;
          stopButton.textContent = "Retry stop";
        }
        toast(`Could not close the location session: ${error.message}`, "error");
        locationStopInProgress = false;
        return;
      }
      activeLocationSession = undefined;
    }
    if (status) status.textContent = message;
    const button = byId("start-location");
    if (button) button.disabled = false;
    locationStopInProgress = false;
  }

  async function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) { toast("Camera access is not supported by this browser.", "error"); return; }
    byId("open-camera").disabled = true;
    let browserGranted = false;
    try {
      imageStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      browserGranted = true;
      const consent = await invoke("create-consent-record", { visit_id: currentVisitId, permission_type: "camera", consent_status: "granted", purpose: "User-initiated photograph capture" });
      imageConsentId = consent.consent_id;
      const area = byId("camera-area");
      area.innerHTML = '<video class="capture-preview" autoplay playsinline aria-label="Live camera preview"></video><div class="d-flex gap-2"><button class="btn btn-sm btn-primary" id="capture-photo" type="button">Capture photograph</button><button class="btn btn-sm btn-light" id="close-camera" type="button">Close camera</button></div>';
      const video = area.querySelector("video");
      video.srcObject = imageStream;
      byId("capture-photo").addEventListener("click", capturePhoto);
      byId("close-camera").addEventListener("click", closeCamera);
    } catch (error) {
      imageStream?.getTracks().forEach((track) => track.stop());
      imageStream = undefined;
      byId("open-camera").disabled = false;
      if (!browserGranted) {
        await invoke("create-consent-record", { visit_id: currentVisitId, permission_type: "camera", consent_status: "denied", purpose: "User declined or browser denied a camera request" }).catch((failure) => toast(`Could not record camera permission result: ${failure.message}`, "error"));
      }
      toast(`Camera could not be opened: ${errorMessage(error)}`, "error");
    }
  }

  function capturePhoto() {
    const video = byId("camera-area").querySelector("video");
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) { toast("Could not capture the photograph.", "error"); return; }
      imageCapture = new File([blob], `evidence-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`, { type: "image/jpeg" });
      closeCamera();
      const area = byId("camera-area");
      const preview = document.createElement("img");
      preview.className = "capture-preview"; preview.alt = "Photograph preview"; preview.src = URL.createObjectURL(imageCapture);
      area.replaceChildren(preview);
      const confirm = document.createElement("button");
      confirm.className = "btn btn-sm btn-primary"; confirm.textContent = "Submit this photograph"; confirm.type = "button";
      confirm.addEventListener("click", () => uploadPublicEvidence(imageCapture, "image", area));
      area.append(confirm);
    }, "image/jpeg", .92);
  }

  function closeCamera() {
    imageStream?.getTracks().forEach((track) => track.stop());
    imageStream = undefined;
    if (byId("open-camera")) byId("open-camera").disabled = false;
    if (byId("camera-area")?.querySelector("video")) byId("camera-area").replaceChildren();
  }

  async function startAudio() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast("Audio recording is not supported by this browser.", "error"); return; }
    byId("start-audio").disabled = true;
    let browserGranted = false;
    try {
      audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      browserGranted = true;
      const consent = await invoke("create-consent-record", { visit_id: currentVisitId, permission_type: "microphone", consent_status: "granted", purpose: "User-controlled audio recording" });
      audioConsentId = consent.consent_id;
      audioChunks = [];
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
      audioRecorder = new MediaRecorder(audioStream, mimeType ? { mimeType } : undefined);
      audioRecorder.addEventListener("dataavailable", (event) => { if (event.data.size) audioChunks.push(event.data); });
      audioRecorder.addEventListener("stop", reviewAudio);
      audioRecorder.start();
      byId("audio-area").innerHTML = '<div class="location-status">Recording is active. The microphone indicator should be visible in your browser.</div><button id="stop-audio" class="btn btn-sm btn-outline-danger mt-2" type="button">Stop recording</button>';
      byId("stop-audio").addEventListener("click", () => audioRecorder?.stop(), { once: true });
    } catch (error) {
      audioStream?.getTracks().forEach((track) => track.stop());
      audioStream = undefined;
      byId("start-audio").disabled = false;
      if (!browserGranted) {
        await invoke("create-consent-record", { visit_id: currentVisitId, permission_type: "microphone", consent_status: "denied", purpose: "User declined or browser denied a microphone request" }).catch((failure) => toast(`Could not record microphone permission result: ${failure.message}`, "error"));
      }
      toast(`Microphone could not be started: ${errorMessage(error)}`, "error");
    }
  }

  function reviewAudio() {
    audioStream?.getTracks().forEach((track) => track.stop());
    audioStream = undefined;
    byId("start-audio").disabled = false;
    const type = audioRecorder?.mimeType || "audio/webm";
    audioCapture = new File([new Blob(audioChunks, { type })], `recording-${new Date().toISOString().replace(/[:.]/g, "-")}.${type.includes("mp4") ? "mp4" : "webm"}`, { type });
    const area = byId("audio-area");
    area.replaceChildren();
    const player = document.createElement("audio"); player.controls = true; player.className = "w-100 my-2"; player.src = URL.createObjectURL(audioCapture); player.setAttribute("aria-label", "Audio recording preview");
    const button = document.createElement("button"); button.className = "btn btn-sm btn-primary"; button.type = "button"; button.textContent = "Submit this recording";
    button.addEventListener("click", () => uploadPublicEvidence(audioCapture, "audio", area));
    area.append(player, button);
  }

  async function uploadPublicEvidence(file, type, area) {
    const limit = type === "image" ? 10 * 1024 * 1024 : 20 * 1024 * 1024;
    if (file.size > limit) { toast(`File is larger than the ${Math.round(limit / 1024 / 1024)} MB limit.`, "error"); return; }
    const consentId = type === "image" ? imageConsentId : audioConsentId;
    if (!consentId) { toast("Permission must be granted before uploading evidence.", "error"); return; }
    const button = area.querySelector("button");
    if (button) { button.disabled = true; button.textContent = "Uploading securely…"; }
    try {
      const start = await invoke("submit-evidence", {
        visit_id: currentVisitId,
        consent_id: consentId,
        evidence_type: type,
        mime_type: file.type.split(";")[0],
        file_size: file.size
      });
      const { error: uploadError } = await client.storage.from(start.storage_bucket)
        .uploadToSignedUrl(start.storage_path, start.upload_token, file, { contentType: start.mime_type, upsert: false });
      if (uploadError) throw uploadError;
      await invoke("complete-evidence-upload", {
        visit_id: currentVisitId,
        consent_id: consentId,
        evidence_type: type,
        storage_path: start.storage_path,
        storage_bucket: start.storage_bucket
      });
      area.textContent = "Your evidence was submitted securely.";
      toast("Evidence submitted.");
    } catch (error) {
      if (button) { button.disabled = false; button.textContent = "Retry submission"; }
      toast(`Evidence upload failed: ${error.message}`, "error");
    }
  }

  async function submitNote() {
    const note = byId("public-note").value.trim();
    if (!note) { toast("Enter a written statement before submitting.", "error"); return; }
    const consent = await invoke("create-consent-record", { visit_id: currentVisitId, permission_type: "written_statement", consent_status: "granted", purpose: "User-initiated written statement submission" });
    try {
      await invoke("submit-written-evidence", { visit_id: currentVisitId, consent_id: consent.consent_id, statement: note });
      byId("public-note").value = "";
      toast("Written statement submitted.");
    } catch (error) { toast(`Statement could not be submitted: ${error.message}`, "error"); }
  }

  async function endPublicSession() {
    if (locationWatch !== undefined || activeLocationSession) await stopLocation();
    closeCamera();
    audioStream?.getTracks().forEach((track) => track.stop());
    window.location.replace("/");
  }

  function stopSensorsOnPageHide() {
    if (locationWatch !== undefined) navigator.geolocation.clearWatch(locationWatch);
    imageStream?.getTracks().forEach((track) => track.stop());
    audioStream?.getTracks().forEach((track) => track.stop());
    if (activeLocationSession && currentVisitId && publicToken) {
      fetch(`${config.supabaseUrl}/functions/v1/end-location-session`, {
        method: "POST",
        headers: {
          apikey: config.supabaseAnonKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ token: publicToken, visit_id: currentVisitId, session_id: activeLocationSession }),
        credentials: "omit",
        keepalive: true
      }).catch((error) => console.error("Could not request location-session closure on page exit.", error));
    }
  }

  function showPasswordRecovery() {
    window.history.replaceState(null, "", "/reset-password");
    byId("password-reset-message").textContent = "Your recovery link is valid. Choose a new password to secure your account.";
    byId("password-update-form").classList.remove("d-none");
    setScreen("password-reset-screen");
  }

  async function setupEvents() {
    byId("login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const { error } = await client.auth.signInWithPassword({ email: form.get("email"), password: form.get("password") });
      if (error) toast(`Sign-in failed: ${error.message}`, "error");
    });
    byId("reset-password").addEventListener("click", async () => {
      const email = document.querySelector('#login-form input[name="email"]').value.trim();
      if (!email) { toast("Enter your account email first.", "error"); return; }
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
      if (error) toast(`Password recovery could not be requested: ${error.message}`, "error");
      else toast("If the account exists, a recovery email has been sent.");
    });
    byId("sign-out").addEventListener("click", async () => {
      const { error } = await client.auth.signOut();
      if (error) toast(`Could not sign out: ${error.message}`, "error");
    });
    byId("new-case-button").addEventListener("click", () => {
      byId("case-form").reset();
      byId("case-modal-title").textContent = "Create a case";
      bootstrap.Modal.getOrCreateInstance(byId("case-modal")).show();
    });
    byId("new-link-button").addEventListener("click", async () => {
      await loadCases();
      const select = document.querySelector('#link-form select[name="case_id"]');
      if (!select.options.length) { toast("Create a case before generating a link.", "error"); return; }
      bootstrap.Modal.getOrCreateInstance(byId("link-modal")).show();
    });
    byId("case-form").addEventListener("submit", createCase);
    byId("link-form").addEventListener("submit", createEvidenceLink);
    byId("case-search").addEventListener("input", () => applyTableFilters("cases-table", "case-search", "case-status-filter"));
    byId("case-status-filter").addEventListener("change", () => applyTableFilters("cases-table", "case-search", "case-status-filter"));
    byId("visit-search").addEventListener("input", () => applyTableFilters("visits-table", "visit-search"));
    byId("evidence-search").addEventListener("input", () => applyTableFilters("evidence-table", "evidence-search", null, "evidence-type-filter"));
    byId("evidence-type-filter").addEventListener("change", () => applyTableFilters("evidence-table", "evidence-search", null, "evidence-type-filter"));
    byId("password-update-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const formData = new FormData(form);
      const password = formData.get("password");
      if (password !== formData.get("password-confirmation")) {
        toast("The passwords do not match.", "error");
        return;
      }
      const { error } = await client.auth.updateUser({ password });
      if (error) toast(`Password could not be changed: ${error.message}`, "error");
      else {
        form.reset();
        const { error: signOutError } = await client.auth.signOut({ scope: "global" });
        setScreen("login-screen");
        if (signOutError) {
          toast("Password updated, but active sessions could not all be revoked. Sign out on your other devices.", "error");
        } else {
          toast("Password updated and active sessions revoked. Sign in with your new password.");
        }
      }
    });
    byId("copy-link").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(byId("created-link-url").value); toast("Evidence link copied."); }
      catch (error) { toast(`Could not copy the link: ${error.message}`, "error"); }
    });
    byId("menu-toggle").addEventListener("click", () => byId("sidebar").classList.toggle("open"));
    byId("export-button").addEventListener("click", async () => {
      try {
        const { data, error } = await client.from("cases").select("id,case_reference,title").order("created_at", { ascending: false });
        if (error) throw error;
        if (!data.length) { toast("There are no case records to report.", "error"); return; }
        const selection = window.prompt(`Enter a case reference to export its evidence record bundle:\n${data.map((item) => `${item.case_reference} — ${item.title}`).join("\n")}`);
        const selected = data.find((item) => item.case_reference.toLowerCase() === selection?.trim().toLowerCase());
        if (!selected) { if (selection !== null) toast("No case matched that reference.", "error"); return; }
        const bundle = await invoke("export-case-evidence", { case_id: selected.id });
        const download = document.createElement("a");
        const fileUrl = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
        download.href = fileUrl;
        download.download = `${selected.case_reference}-evidence-export.json`;
        download.click();
        window.setTimeout(() => URL.revokeObjectURL(fileUrl), 30000);
        toast("Evidence export downloaded. Private file links expire in 60 seconds.");
      } catch (error) { toast(`Case report could not be started: ${error.message}`, "error"); }
    });
    window.addEventListener("pagehide", stopSensorsOnPageHide);
  }

  setupEvents();
  start().catch((error) => {
    setScreen("login-screen");
    toast(`Application initialization failed: ${error.message}`, "error");
  });
})();
