const accountStorageKey = "offCampusDemoAccounts";
const sessionStorageKey = "offCampusDemoSession";
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
	{ id: "willow-house", title: "Kabwe Central Room", area: "Kabwe Central", type: "Private room", price: 1800 },
	{ id: "cedar-studio", title: "Chowa Self-Contained Unit", area: "Chowa, Kabwe", type: "Studio", price: 3200 },
	{ id: "elm-flat", title: "Makululu Shared House", area: "Makululu, Kabwe", type: "Shared room", price: 1500 },
	{ id: "park-view", title: "Highridge One-Bedroom", area: "Highridge, Kabwe", type: "Entire apartment", price: 4500 },
	{ id: "birch-room", title: "Railway Area Private Room", area: "Railway area, Kabwe", type: "Private room", price: 2200 },
	{ id: "market-loft", title: "Great North Road Studio", area: "Great North Road area, PPC", type: "Studio", price: 3500 }
];

function escapeHtml(value) {
	return String(value ?? "").replace(/[&<>"']/g, (character) => ({
		"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
	})[character]);
}

function getAccounts() {
	const stored = localStorage.getItem(accountStorageKey);
	const accounts = stored === null ? [] : JSON.parse(stored);
	if (!Array.isArray(accounts) || accounts.some((account) =>
		!account || typeof account !== "object" || typeof account.email !== "string" ||
		typeof account.password !== "string" || !dashboardPaths[account.role]
	)) {
		throw new Error("Saved demo accounts are invalid. Clear this site's browser storage and try again.");
	}
	if (!accounts.some((account) => account.email === demoAdmin.email)) accounts.push(demoAdmin);
	localStorage.setItem(accountStorageKey, JSON.stringify(accounts));
	return accounts;
}

function getCurrentUser() {
	const stored = localStorage.getItem(sessionStorageKey);
	if (!stored) return null;
	const user = JSON.parse(stored);
	if (!user || !dashboardPaths[user.role]) return null;
	return user;
}

function showStatus(element, message, isError = true) {
	if (!element) return;
	element.textContent = message;
	element.classList.toggle("error", isError);
}

const loginForm = document.querySelector("#login-form");
if (loginForm) {
	const status = document.querySelector("#login-status");
	const resetToggle = document.querySelector("#forgot-password-toggle");
	const resetPanel = document.querySelector("#password-reset-panel");
	const resetClose = document.querySelector("#reset-close");
	const notice = new URLSearchParams(window.location.search).get("notice");
	if (notice) {
		showStatus(status, notice === "sign-in-required" ? "Sign in to open your dashboard." : notice, false);
	}

	const setResetPanelVisible = (visible) => {
		resetPanel.hidden = !visible;
		resetToggle.setAttribute("aria-expanded", String(visible));
		if (visible) resetPanel.querySelector('input[name="email"]').focus();
	};
	resetToggle.addEventListener("click", () => setResetPanelVisible(resetPanel.hidden));
	resetClose.addEventListener("click", () => setResetPanelVisible(false));

	loginForm.addEventListener("submit", (event) => {
		event.preventDefault();
		try {
			const values = Object.fromEntries(new FormData(loginForm));
			const identifier = values.identifier.trim().toLowerCase();
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

	const resetForm = document.querySelector("#password-reset-form");
	const resetStatus = document.querySelector("#reset-status");
	resetForm.addEventListener("submit", (event) => {
		event.preventDefault();
		try {
			const values = Object.fromEntries(new FormData(resetForm));
			const email = values.email.trim().toLowerCase();
			if (values.newPassword.length < 8 || values.newPassword.length > 128) {
				showStatus(resetStatus, "Password must be between 8 and 128 characters.");
				return;
			}
			if (values.newPassword !== values.confirmPassword) {
				showStatus(resetStatus, "The passwords do not match.");
				return;
			}
			const accounts = getAccounts();
			const account = accounts.find((candidate) => candidate.email.toLowerCase() === email);
			if (!account) {
				showStatus(resetStatus, "No account with that email was found in this browser.");
				return;
			}
			account.password = values.newPassword;
			localStorage.setItem(accountStorageKey, JSON.stringify(accounts));
			loginForm.elements.identifier.value = email;
			loginForm.elements.password.focus();
			resetForm.reset();
			showStatus(resetStatus, "Password updated. You can now sign in with your new password.", false);
		} catch (error) {
			showStatus(resetStatus, error.message || "Could not update the password in browser storage.");
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
			const email = values.email.trim().toLowerCase();
			const studentId = values.studentId.trim();
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
				name: values.name.trim(),
				email,
				phone: values.phone.trim(),
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
			document.querySelector("[data-user-name]").textContent = user.name;
			document.querySelector("[data-user-email]").textContent = user.email;
			if (rolePage === "student") {
				const bookingsNode = document.querySelector("#student-bookings");
				const bookings = JSON.parse(localStorage.getItem("offCampusDemoBookings") || "[]");
				if (!Array.isArray(bookings)) throw new Error("Saved booking requests are invalid.");
				const userBookings = bookings.filter((booking) => booking.studentEmail === user.email);
				bookingsNode.innerHTML = userBookings.length ? userBookings.map((booking) => `
					<article class="portal-booking-item">
						<strong>${escapeHtml(booking.listingTitle || booking.listingId)}</strong>
						<p>${escapeHtml(booking.accommodationType)} · Move-in ${escapeHtml(booking.moveInDate)} · <span class="status-pill">${escapeHtml(booking.status)}</span></p>
					</article>`).join("") : "<p>You have not made a demo booking request yet.</p>";
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
			document.querySelector("[data-booking-user]").textContent = user.name;
			const bookingStatus = document.querySelector("#booking-status");
			const listingSelect = bookingForm.elements.listingId;
			bookingForm.elements.moveInDate.min = new Date().toISOString().slice(0, 10);
			listingSelect.innerHTML = '<option value="" selected disabled>Choose accommodation</option>' + demoListings.map((listing) =>
				`<option value="${listing.id}">${escapeHtml(listing.title)} · ${escapeHtml(listing.area)} · K ${listing.price.toLocaleString("en-ZM")} / month</option>`
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
						accommodationType: listing.type,
						moveInDate: values.moveInDate,
						message: values.message.trim(),
						status: "pending",
						submittedAt: new Date().toISOString()
					};
					const bookings = JSON.parse(localStorage.getItem("offCampusDemoBookings") || "[]");
					if (!Array.isArray(bookings)) throw new Error("Saved booking requests are invalid.");
					bookings.push(request);
					localStorage.setItem("offCampusDemoBookings", JSON.stringify(bookings));
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

document.querySelectorAll("[data-sign-out]").forEach((button) => {
	button.addEventListener("click", () => {
		localStorage.removeItem(sessionStorageKey);
		window.location.assign("/");
	});
});
