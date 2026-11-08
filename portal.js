const accountStorageKey = "offCampusDemoAccounts";
const sessionStorageKey = "offCampusDemoSession";
const favoritesStorageKey = "offCampusDemoFavorites";
const requestStorageKey = "offCampusDemoRequests";
const dashboardPaths = {
  student: "/student.html",
  landlord: "/landlord.html",
  admin: "/admin.html"
};

const demoAdmin = {
  name: "Demo Administrator",
  email: "admin@mulungushi.local",
  phone: "",
  role: "admin",
  studentId: "",
  password: "admin123",
  verified: true
};

const demoListings = [
  { id: "willow-house", title: "Kabwe Central Room", area: "Kabwe Central", type: "Private room", price: 1800, image: "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=960&q=85", details: ["Shared kitchen", "Water storage", "Close to transport"], tag: "Popular" },
  { id: "cedar-studio", title: "Chowa Self-Contained Unit", area: "Chowa, Kabwe", type: "Studio", price: 3200, image: "https://images.unsplash.com/photo-1493809842364-78817add7ffb?auto=format&fit=crop&w=960&q=85", details: ["Private bathroom", "Prepaid power", "Quiet block"], tag: "New" },
  { id: "elm-flat", title: "Makululu Shared House", area: "Makululu, Kabwe", type: "Shared room", price: 1500, image: "https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?auto=format&fit=crop&w=960&q=85", details: ["Shared kitchen", "Water storage", "Study-friendly"], tag: "Value" },
  { id: "park-view", title: "Highridge One-Bedroom", area: "Highridge, Kabwe", type: "Entire apartment", price: 4500, image: "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=960&q=85", details: ["Private kitchen", "Secure entry", "Near shopping"], tag: "Premium" },
  { id: "birch-room", title: "Railway Area Private Room", area: "Railway area, Kabwe", type: "Private room", price: 2200, image: "https://images.unsplash.com/photo-1518780664697-55e3ad937233?auto=format&fit=crop&w=960&q=85", details: ["Secure yard", "Shared bathroom", "Campus route"], tag: "Quiet" },
  { id: "market-loft", title: "Great North Road Studio", area: "Great North Road area, PPC", type: "Studio", price: 3500, image: "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=960&q=85", details: ["Self-contained", "Prepaid power", "Furnished"], tag: "Featured" }
];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function readJson(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) return fallback;
    const parsed = JSON.parse(stored);
    return parsed ?? fallback;
  } catch (error) {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getAccounts() {
  const stored = readJson(accountStorageKey, []);
  const accounts = Array.isArray(stored) ? stored : [];
  if (accounts.some((account) =>
    !account || typeof account !== "object" || typeof account.email !== "string" ||
    typeof account.password !== "string" || !dashboardPaths[account.role]
  )) {
    throw new Error("Saved demo accounts are invalid. Clear this site's browser storage and try again.");
  }
  if (!accounts.some((account) => account.email === demoAdmin.email)) {
    accounts.push(demoAdmin);
    writeJson(accountStorageKey, accounts);
  }
  return accounts;
}

function getCurrentUser() {
  const stored = localStorage.getItem(sessionStorageKey);
  if (!stored) return null;
  const user = JSON.parse(stored);
  if (!user || !dashboardPaths[user.role]) return null;
  return user;
}

function getSavedListingIds() {
  const saved = readJson(favoritesStorageKey, []);
  return Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : [];
}

function saveListingFavorite(id, shouldSave) {
  const saved = getSavedListingIds();
  const next = shouldSave ? Array.from(new Set([...saved, id])) : saved.filter((current) => current !== id);
  writeJson(favoritesStorageKey, next);
  updateSavedBadge();
}

function updateSavedBadge() {
  const count = document.querySelector("#saved-count");
  if (count) count.textContent = String(getSavedListingIds().length);
}

function getRequests() {
  const stored = readJson(requestStorageKey, []);
  return Array.isArray(stored) ? stored : [];
}

function showStatus(element, message, isError = true) {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("error", isError);
}

function renderListingCards() {
  const grid = document.querySelector("#listing-grid");
  const resultCount = document.querySelector("#result-count");
  const searchForm = document.querySelector("#listing-search");
  const sortSelect = document.querySelector("#sort-listings");
  const savedToggle = document.querySelector("#saved-toggle");
  if (!grid || !searchForm || !sortSelect) return;

  const data = new FormData(searchForm);
  const location = String(data.get("location") || "").trim().toLowerCase();
  const roomType = String(data.get("roomType") || "all");
  const maxBudget = Number(data.get("budget") || "0") || 0;
  const savedOnly = savedToggle?.getAttribute("aria-pressed") === "true";
  const savedIds = getSavedListingIds();

  let filtered = demoListings.filter((listing) => {
    const matchesLocation = !location || listing.area.toLowerCase().includes(location) || listing.title.toLowerCase().includes(location);
    const matchesType = roomType === "all" || listing.type === roomType;
    const matchesBudget = !maxBudget || listing.price <= maxBudget;
    const matchesSaved = !savedOnly || savedIds.includes(listing.id);
    return matchesLocation && matchesType && matchesBudget && matchesSaved;
  });

  const sortValue = sortSelect.value;
  if (sortValue === "price-asc") filtered = [...filtered].sort((a, b) => a.price - b.price);
  if (sortValue === "price-desc") filtered = [...filtered].sort((a, b) => b.price - a.price);
  if (sortValue === "name") filtered = [...filtered].sort((a, b) => a.title.localeCompare(b.title));

  resultCount.textContent = `${filtered.length} ${filtered.length === 1 ? "home" : "homes"}`;

  if (!filtered.length) {
    grid.innerHTML = `
      <article class="empty-state">
        <span aria-hidden="true">⌕</span>
        <h3>No homes match that filter</h3>
        <p>Adjust your location, budget, or room type to see more options.</p>
        <button class="text-button" type="button" data-reset-filters>Reset filters</button>
      </article>`;
    return;
  }

  grid.innerHTML = filtered.map((listing) => {
    const isSaved = savedIds.includes(listing.id);
    const details = [...listing.details].slice(0, 3).map((detail) => `<span>${escapeHtml(detail)}</span>`).join("");
    return `
      <article class="listing-card" aria-label="${escapeHtml(listing.title)}">
        <div class="listing-image-wrap">
          <img class="listing-image" src="${listing.image}" alt="${escapeHtml(listing.title)}" loading="lazy">
          <span class="listing-tag">${escapeHtml(listing.tag)}</span>
          <button class="favorite-button" type="button" data-favorite-id="${listing.id}" aria-label="${isSaved ? "Remove from saved" : "Save listing"}" aria-pressed="${String(isSaved)}">${isSaved ? "♥" : "♡"}</button>
        </div>
        <div class="listing-content">
          <p class="listing-location"><span aria-hidden="true">⌖</span> ${escapeHtml(listing.area)}</p>
          <div class="listing-title-row">
            <h3 class="listing-title">${escapeHtml(listing.title)}</h3>
            <span class="listing-price">K ${Number(listing.price).toLocaleString("en-ZM")}<small>/mo</small></span>
          </div>
          <div class="listing-meta">${details}</div>
          <div class="listing-footer">
            <span class="availability">${escapeHtml(listing.type)}</span>
            <button class="view-button" type="button" data-book-listing="${listing.id}">Request room</button>
          </div>
        </div>
      </article>
    `;
  }).join("");

  const resetButton = document.querySelector("[data-reset-filters]");
  if (resetButton) resetButton.addEventListener("click", () => {
    searchForm.reset();
    savedToggle?.setAttribute("aria-pressed", "false");
    renderListingCards();
  });

  grid.querySelectorAll("[data-favorite-id]").forEach((button) => {
    button.addEventListener("click", () => {
      saveListingFavorite(button.dataset.favoriteId, button.getAttribute("aria-pressed") !== "true");
      button.setAttribute("aria-pressed", String(!button.getAttribute("aria-pressed") || button.getAttribute("aria-pressed") === "false"));
      button.textContent = button.getAttribute("aria-pressed") === "true" ? "♥" : "♡";
      renderListingCards();
    });
  });

  grid.querySelectorAll("[data-book-listing]").forEach((button) => {
    button.addEventListener("click", () => {
      const select = document.querySelector("#listing-select");
      if (select) {
        select.value = button.dataset.bookListing;
      }
      const form = document.querySelector("#request-form");
      if (form) form.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function populateListingSelect() {
  const select = document.querySelector("#listing-select");
  if (!select) return;
  select.innerHTML = '<option value="">Choose from homes below</option>' + demoListings.map((listing) =>
    `<option value="${listing.id}">${escapeHtml(listing.title)} · ${escapeHtml(listing.area)} · K ${Number(listing.price).toLocaleString("en-ZM")}/mo</option>`
  ).join("");
}

function attachLandingPageHandlers() {
  const searchForm = document.querySelector("#listing-search");
  const sortSelect = document.querySelector("#sort-listings");
  const savedToggle = document.querySelector("#saved-toggle");

  if (searchForm) {
    searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      renderListingCards();
    });
  }

  if (sortSelect) {
    sortSelect.addEventListener("change", renderListingCards);
  }

  if (savedToggle) {
    savedToggle.addEventListener("click", () => {
      const pressed = savedToggle.getAttribute("aria-pressed") === "true";
      savedToggle.setAttribute("aria-pressed", String(!pressed));
      renderListingCards();
    });
  }

  const requestForm = document.querySelector("#request-form");
  const requestStatus = document.querySelector("#request-status");
  const requestSummary = document.querySelector("#request-summary");

  if (requestForm) {
    requestForm.elements.moveIn.min = new Date().toISOString().slice(0, 10);
    requestForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(requestForm));
      const facilities = Array.isArray(values.facilities) ? values.facilities : values.facilities ? [values.facilities] : [];
      const request = {
        id: crypto.randomUUID(),
        name: String(values.name || "").trim(),
        email: String(values.email || "").trim(),
        phone: String(values.phone || "").trim(),
        campus: String(values.campus || "Mulungushi University").trim(),
        roomType: String(values.roomType || "").trim(),
        budget: Number(values.budget),
        moveIn: String(values.moveIn || "").trim(),
        message: String(values.message || "").trim(),
        listingId: String(values.listingId || "").trim(),
        facilities,
        status: "pending",
        createdAt: new Date().toISOString()
      };

      const errors = [];
      if (!request.name || request.name.length < 2) errors.push("Enter a valid full name.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(request.email)) errors.push("Enter a valid email address.");
      if (!/^(?:\+260|0)?[0-9]{9}$/.test(request.phone.replace(/[\s()-]/g, ""))) errors.push("Enter a valid Zambian phone number.");
      if (!request.roomType) errors.push("Select a preferred room type.");
      if (!Number.isFinite(request.budget) || request.budget < 1 || request.budget > 100000) errors.push("Enter a monthly budget between K 1 and K 100,000.");
      if (!request.moveIn || new Date(`${request.moveIn}T00:00:00Z`).toString() === "Invalid Date") errors.push("Choose a valid move-in date.");
      if (!values.consent) errors.push("Please confirm the accommodation request details.");

      if (errors.length) {
        if (requestSummary) {
          requestSummary.textContent = errors.join(" ");
          requestSummary.classList.add("error");
        }
        showStatus(requestStatus, "Please fix the highlighted request details.");
        return;
      }

      const requests = getRequests();
      requests.unshift(request);
      writeJson(requestStorageKey, requests);

      if (requestSummary) {
        requestSummary.textContent = "";
        requestSummary.classList.remove("error");
      }
      showStatus(requestStatus, "Accommodation request submitted successfully.", false);
      requestForm.reset();
      requestForm.elements.campus.value = "Mulungushi University";
      requestForm.elements.moveIn.min = new Date().toISOString().slice(0, 10);
      if (document.querySelector("#listing-select")) document.querySelector("#listing-select").value = "";
    });
  }
}

function renderStudentDashboard() {
  const user = getCurrentUser();
  if (!user || user.role !== "student") return;
  const node = document.querySelector("#student-bookings");
  if (!node) return;

  const requests = getRequests().filter((request) => request.email && request.email.toLowerCase() === user.email.toLowerCase());
  if (!requests.length) {
    node.innerHTML = "<p>You have not made a demo booking request yet.</p>";
    return;
  }

  node.innerHTML = requests.map((request) => {
    const listing = demoListings.find((candidate) => candidate.id === request.listingId);
    const title = listing ? listing.title : (request.listingId || "Accommodation request");
    return `
      <article class="portal-booking-item">
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(request.roomType || "Accommodation request")} · Move-in ${escapeHtml(request.moveIn || "TBD")} · <span class="status-pill ${escapeHtml(request.status || "pending")}">${escapeHtml(request.status || "pending")}</span></p>
      </article>
    `;
  }).join("");
}

function renderLandlordDashboard() {
  const user = getCurrentUser();
  if (!user || user.role !== "landlord") return;
  const summaryNode = document.querySelector("#landlord-summary");
  const requestNode = document.querySelector("#landlord-requests");
  const propertyNode = document.querySelector("#landlord-properties");
  if (!summaryNode || !requestNode || !propertyNode) return;

  const requests = getRequests().slice(0, 4);
  summaryNode.innerHTML = `
    <div class="dashboard-item"><div><strong>Properties</strong><p>Live demo listings</p></div><span>${demoListings.length}</span></div>
    <div class="dashboard-item"><div><strong>Open requests</strong><p>New student inquiries</p></div><span>${requests.length}</span></div>
    <div class="dashboard-item"><div><strong>Average rent</strong><p>Typical monthly amount</p></div><span>K ${Math.round(demoListings.reduce((total, listing) => total + listing.price, 0) / demoListings.length).toLocaleString("en-ZM")}</span></div>
  `;

  requestNode.innerHTML = requests.length
    ? requests.map((request) => `
        <div class="dashboard-item">
          <div>
            <strong>${escapeHtml(request.name)}</strong>
            <p>${escapeHtml(request.roomType)} · ${escapeHtml(request.moveIn)}</p>
          </div>
          <div class="dashboard-item-actions">
            <span class="status-pill ${escapeHtml(request.status || "pending")}">${escapeHtml(request.status || "pending")}</span>
            <button type="button" data-review-request="${request.id}">Review</button>
          </div>
        </div>
      `).join("")
    : "<p>No new requests yet.</p>";

  propertyNode.innerHTML = demoListings.map((listing) => `
    <article class="dashboard-card landlord-property">
      <div class="property-heading">
        <div>
          <h2>${escapeHtml(listing.title)}</h2>
          <p>${escapeHtml(listing.area)}</p>
        </div>
        <span class="status-pill">${escapeHtml(listing.type)}</span>
      </div>
      <div class="property-image">
        <img src="${listing.image}" alt="${escapeHtml(listing.title)}">
      </div>
      <div class="property-actions">
        <button type="button">Update details</button>
        <button type="button" class="secondary-action">Review leads</button>
      </div>
    </article>
  `).join("");

  document.querySelectorAll("[data-review-request]").forEach((button) => {
    button.addEventListener("click", () => {
      const requests = getRequests();
      const updatedRequests = requests.map((request) => request.id === button.dataset.reviewRequest ? { ...request, status: "reviewed" } : request);
      writeJson(requestStorageKey, updatedRequests);
      renderLandlordDashboard();
    });
  });
}

function renderAdminDashboard() {
  const user = getCurrentUser();
  if (!user || user.role !== "admin") return;

  const userNode = document.querySelector("#admin-users");
  const reviewNode = document.querySelector("#admin-approvals");
  const requestNode = document.querySelector("#admin-requests");
  if (!userNode || !reviewNode || !requestNode) return;

  const accounts = getAccounts().filter((account) => account.role !== "admin");
  userNode.innerHTML = accounts.length
    ? accounts.map((account) => `
        <div class="dashboard-item">
          <div>
            <strong>${escapeHtml(account.name)}</strong>
            <p>${escapeHtml(account.email)} · ${escapeHtml(account.role)}</p>
          </div>
          <div class="dashboard-item-actions">
            <span class="status-pill ${account.verified ? "approved" : "pending"}">${account.verified ? "approved" : "pending"}</span>
            <button type="button" data-toggle-user-status="${account.email}">${account.verified ? "Suspend" : "Approve"}</button>
          </div>
        </div>
      `).join("")
    : "<p>No user approvals are pending.</p>";

  reviewNode.innerHTML = demoListings.slice(0, 3).map((listing) => `
    <div class="dashboard-item">
      <div>
        <strong>${escapeHtml(listing.title)}</strong>
        <p>${escapeHtml(listing.area)}</p>
      </div>
      <div class="dashboard-item-actions">
        <button type="button" data-approve-listing="${listing.id}">Approve</button>
      </div>
    </div>
  `).join("");

  const requests = getRequests().slice(0, 4);
  requestNode.innerHTML = requests.length
    ? requests.map((request) => `
        <div class="dashboard-item">
          <div>
            <strong>${escapeHtml(request.name)}</strong>
            <p>${escapeHtml(request.listingId || "Accommodation request")} · ${escapeHtml(request.roomType)}</p>
          </div>
          <div class="dashboard-item-actions">
            <span class="status-pill ${escapeHtml(request.status || "pending")}">${escapeHtml(request.status || "pending")}</span>
            <button type="button" data-review-request-admin="${request.id}">Resolve</button>
          </div>
        </div>
      `).join("")
    : "<p>No requests to review.</p>";

  document.querySelectorAll("[data-toggle-user-status]").forEach((button) => {
    button.addEventListener("click", () => {
      const accounts = getAccounts();
      const updated = accounts.map((account) => { if (account.email === button.dataset.toggleUserStatus) { return { ...account, verified: !account.verified }; } return account; });
      writeJson(accountStorageKey, updated);
      renderAdminDashboard();
    });
  });

  document.querySelectorAll("[data-review-request-admin]").forEach((button) => {
    button.addEventListener("click", () => {
      const requests = getRequests().map((request) => request.id === button.dataset.reviewRequestAdmin ? { ...request, status: "approved" } : request);
      writeJson(requestStorageKey, requests);
      renderAdminDashboard();
    });
  });

  document.querySelectorAll("[data-approve-listing]").forEach((button) => {
    button.addEventListener("click", () => {
      const node = button.closest(".dashboard-item");
      if (node) {
        node.innerHTML = `<div><strong>Listing approved</strong><p>Ready to publish</p></div><span class="status-pill approved">approved</span>`;
      }
    });
  });
}

const loginForm = document.querySelector("#login-form");
if (loginForm) {
  const status = document.querySelector("#login-status");
  const notice = new URLSearchParams(window.location.search).get("notice");
  if (notice) {
    showStatus(status, notice === "sign-in-required" ? "Sign in to open your dashboard." : notice, false);
  }

  loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const values = Object.fromEntries(new FormData(loginForm));
      const identifier = String(values.identifier || "").trim().toLowerCase();
      const account = getAccounts().find((candidate) =>
        (candidate.name.toLowerCase() === identifier || candidate.email.toLowerCase() === identifier ||
          candidate.phone.replace(/[^\d+]/g, "") === identifier.replace(/[^\d+]/g, "")) &&
        candidate.password === values.password && candidate.role === values.role
      );
      if (!account) {
        showStatus(status, "Role, username/email/phone, or password is incorrect.");
        return;
      }
      const sessionUser = {
        name: account.name,
        email: account.email,
        role: account.role,
        verified: account.verified
      };
      localStorage.setItem(sessionStorageKey, JSON.stringify(sessionUser));
      window.location.assign(dashboardPaths[account.role]);
    } catch (error) {
      showStatus(status, error.message || "Could not read demo accounts from browser storage.");
    }
  });
}

const registerForm = document.querySelector("#register-form");
if (registerForm) {
  const status = document.querySelector("#register-status");
  const roleSelect = document.querySelector("#register-role");
  const studentIdField = document.querySelector("#student-id-field");
  const studentIdInput = document.querySelector("#register-student-id");
  const landlordNote = document.querySelector("#landlord-approval-note");

  const updateRegistrationFields = () => {
    const isStudent = roleSelect.value === "student";
    studentIdField.hidden = !isStudent;
    studentIdInput.required = isStudent;
    landlordNote.hidden = isStudent;
  };

  roleSelect.addEventListener("change", updateRegistrationFields);
  updateRegistrationFields();

  registerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const values = Object.fromEntries(new FormData(registerForm));
      const email = String(values.email || "").trim().toLowerCase();
      const studentId = String(values.studentId || "").trim();
      const accounts = getAccounts();
      if (!["student", "landlord"].includes(values.role)) {
        showStatus(status, "Choose a student or landlord account.");
        return;
      }
      if (accounts.some((account) => account.email.toLowerCase() === email)) {
        showStatus(status, "An account with this email already exists.");
        return;
      }
      if (values.role === "student" && accounts.some((account) =>
        account.role === "student" && account.studentId.toLowerCase() === studentId.toLowerCase()
      )) {
        showStatus(status, "This student ID is already registered.");
        return;
      }

      const account = {
        name: String(values.name || "").trim(),
        email,
        phone: String(values.phone || "").trim(),
        role: values.role,
        studentId: values.role === "student" ? studentId : "",
        password: values.password,
        verified: values.role === "student"
      };
      accounts.push(account);
      localStorage.setItem(accountStorageKey, JSON.stringify(accounts));
      localStorage.setItem(sessionStorageKey, JSON.stringify({
        name: account.name,
        email: account.email,
        role: account.role,
        verified: account.verified
      }));
      window.location.assign(dashboardPaths[account.role]);
    } catch (error) {
      showStatus(status, error.message || "Could not save the demo account in browser storage.");
    }
  });
}

const rolePage = document.body.dataset.rolePage;
if (rolePage) {
  try {
    const user = getCurrentUser();
    if (!user) {
      window.location.replace("/?notice=sign-in-required");
    } else if (user.role !== rolePage) {
      window.location.replace(dashboardPaths[user.role]);
    } else {
      const nameNode = document.querySelector("[data-user-name]");
      const emailNode = document.querySelector("[data-user-email]");
      if (nameNode) nameNode.textContent = user.name;
      if (emailNode) emailNode.textContent = user.email;

      if (rolePage === "student") {
        renderStudentDashboard();
      }
      if (rolePage === "landlord") {
        renderLandlordDashboard();
      }
      if (rolePage === "admin") {
        renderAdminDashboard();
      }

      const approval = document.querySelector("[data-user-approval]");
      if (approval) {
        approval.textContent = user.verified ? "Approved" : "Pending administrator approval";
      }
    }
  } catch (error) {
    window.location.replace(`/?notice=${encodeURIComponent(error.message)}`);
  }
}

const bookingForm = document.querySelector("#booking-form");
if (bookingForm && document.body.dataset.bookingPage === "student") {
  try {
    const user = getCurrentUser();
    if (!user) {
      window.location.replace("/?notice=sign-in-required");
    } else if (user.role !== "student") {
      window.location.replace(dashboardPaths[user.role]);
    } else {
      const userName = document.querySelector("[data-booking-user]");
      if (userName) userName.textContent = user.name;
      const bookingStatus = document.querySelector("#booking-status");
      const listingSelect = bookingForm.elements.listingId;
      bookingForm.elements.moveInDate.min = new Date().toISOString().slice(0, 10);
      listingSelect.innerHTML = '<option value="" selected disabled>Choose accommodation</option>' + demoListings.map((listing) =>
        `<option value="${listing.id}">${escapeHtml(listing.title)} · ${escapeHtml(listing.area)} · K ${Number(listing.price).toLocaleString("en-ZM")} / month</option>`
      ).join("");

      bookingForm.addEventListener("submit", (event) => {
        event.preventDefault();
        try {
          const values = Object.fromEntries(new FormData(bookingForm));
          const listing = demoListings.find((candidate) => candidate.id === values.listingId);
          if (!listing) throw new Error("Choose an accommodation from the list.");
          const request = {
            id: crypto.randomUUID(),
            studentEmail: user.email,
            studentName: user.name,
            listingId: values.listingId,
            listingTitle: listing.title,
            roomType: listing.type,
            moveIn: values.moveInDate,
            message: values.message.trim(),
            status: "pending",
            name: user.name,
            email: user.email,
            phone: "",
            campus: "Mulungushi University",
            budget: listing.price,
            createdAt: new Date().toISOString()
          };

          const existing = readJson(requestStorageKey, []);
          const requests = Array.isArray(existing) ? existing : [];
          requests.unshift(request);
          writeJson(requestStorageKey, requests);
          showStatus(bookingStatus, "Your demo booking request was saved in this browser.", false);
          bookingForm.reset();
          listingSelect.value = "";
        } catch (error) {
          showStatus(bookingStatus, error.message || "Could not save the booking request.");
        }
      });
    }
  } catch (error) {
    const status = document.querySelector("#booking-status");
    if (status) showStatus(status, error.message || "Could not load booking data.");
  }
}

if (document.body.dataset.page === "landing") {
  populateListingSelect();
  attachLandingPageHandlers();
  renderListingCards();
  updateSavedBadge();
}

document.querySelectorAll("[data-sign-out]").forEach((button) => {
  button.addEventListener("click", () => {
    localStorage.removeItem(sessionStorageKey);
    window.location.assign("/");
  });
});