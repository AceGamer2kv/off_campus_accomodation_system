const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { createDatabase } = require("./database");

const allowedRoomTypes = new Set(["Private room", "Shared room", "Studio", "Entire apartment", "Open to options"]);
const allowedFacilities = new Set(["water-storage", "secure-yard", "prepaid-power"]);
const allowedListingTypes = new Set(["private", "shared", "studio", "apartment"]);
const sessionDurationMs = 7 * 24 * 60 * 60 * 1000;
const clientIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hashPassword(password, salt) {
	return crypto.scryptSync(password, salt, 64).toString("hex");
}

function passwordMatches(password, salt, storedHash) {
	const actual = Buffer.from(hashPassword(password, salt), "hex");
	const expected = Buffer.from(storedHash, "hex");
	return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function logActivity(database, actorId, action, details) {
	database.prepare("INSERT INTO activity_logs (actor_id, action, details) VALUES (?, ?, ?)").run(actorId || null, action, details);
}

function safeUser(user) {
	return {
		id: user.id,
		name: user.name,
		email: user.email,
		studentId: user.student_id || null,
		phone: user.phone,
		role: user.role,
		verified: Boolean(user.verified),
		createdAt: user.created_at,
		deletedAt: user.deleted_at || null
	};
}

function isValidDate(value) {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T00:00:00.000Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function formatMonth(date) {
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getRentSummary(booking, now = new Date()) {
	if (!booking.rentDueDay) return { rentDueDate: null, rentMonth: null, rentStatus: "schedule_needed" };
	const acceptedAt = new Date(booking.acceptedAt || booking.createdAt);
	const acceptedMonth = formatMonth(acceptedAt);
	let dueMonth = formatMonth(now);
	const currentDue = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), booking.rentDueDay));
	if (acceptedAt > currentDue) {
		const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
		dueMonth = formatMonth(nextMonth);
	}
	const payments = booking.payments || [];
	const currentPayment = payments.find((payment) => payment.rentMonth === dueMonth);
	if (currentPayment) {
		const nextMonth = new Date(Date.UTC(Number(dueMonth.slice(0, 4)), Number(dueMonth.slice(5, 7)), 1));
		dueMonth = formatMonth(nextMonth);
	}
	if (dueMonth < acceptedMonth) dueMonth = acceptedMonth;
	const [year, month] = dueMonth.split("-").map(Number);
	const dueDate = new Date(Date.UTC(year, month - 1, booking.rentDueDay));
	const dueDateText = dueDate.toISOString().slice(0, 10);
	const payment = payments.find((item) => item.rentMonth === dueMonth);
	const status = payment ? "paid" : dueDateText < now.toISOString().slice(0, 10) ? "overdue" : "due";
	return {
		rentDueDate: dueDateText,
		rentMonth: dueMonth,
		rentStatus: status,
		lastPaidOn: payments[0]?.paidOn || null,
		lastPaidMonth: payments[0]?.rentMonth || null,
		lastPaidAmount: payments[0]?.amountZmw || null
	};
}

function issueSession(database, userId, res) {
	const token = crypto.randomBytes(32).toString("hex");
	const expiresAt = new Date(Date.now() + sessionDurationMs).toISOString();
	database.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(
		crypto.createHash("sha256").update(token).digest("hex"),
		userId,
		expiresAt
	);
	const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
	res.append("Set-Cookie", `accommodation_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(sessionDurationMs / 1000)}${secure}`);
}

function clearSessionCookie(res) {
	res.append("Set-Cookie", "accommodation_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
}

function getSessionToken(cookieHeader) {
	const value = cookieHeader?.split(";").map((part) => part.trim()).find((part) => part.startsWith("accommodation_session="))?.slice("accommodation_session=".length);
	return /^[a-f0-9]{64}$/i.test(value || "") ? value : null;
}

function requireRole(...roles) {
	return (req, res, next) => {
		if (!req.user) return res.status(401).json({ error: "Sign in to continue." });
		if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: "You do not have permission to do that." });
		next();
	};
}

function validateListing(body) {
	const errors = {};
	const title = typeof body.title === "string" ? body.title.trim() : "";
	const area = typeof body.area === "string" ? body.area.trim() : "";
	const price = Number(body.price);
	const totalSpaces = body.totalSpaces === undefined ? 1 : Number(body.totalSpaces);
	const availableSpaces = body.availableSpaces === undefined ? totalSpaces : Number(body.availableSpaces);
	const type = typeof body.type === "string" ? body.type : "";
	const details = typeof body.details === "string"
		? body.details.split(",").map((value) => value.trim()).filter(Boolean).slice(0, 8)
		: [];
	const image = typeof body.image === "string" ? body.image : "";
	const alt = typeof body.alt === "string" ? body.alt.trim() : "";

	if (title.length < 3 || title.length > 100) errors.title = "Title must be between 3 and 100 characters.";
	if (area.length < 2 || area.length > 120) errors.area = "Enter a location between 2 and 120 characters.";
	if (!allowedListingTypes.has(type)) errors.type = "Choose a valid accommodation type.";
	if (!Number.isSafeInteger(price) || price < 1 || price > 100000) errors.price = "Monthly rent must be a whole amount from K 1 to K 100,000.";
	if (!Number.isSafeInteger(totalSpaces) || totalSpaces < 1 || totalSpaces > 1000) errors.totalSpaces = "Total spaces must be a whole number from 1 to 1,000.";
	if (!Number.isSafeInteger(availableSpaces) || availableSpaces < 0 || availableSpaces > totalSpaces) errors.availableSpaces = "Available spaces must be a whole number from 0 up to the total spaces.";
	if (details.some((value) => value.length > 60)) errors.details = "Each feature must be 60 characters or fewer.";
	if (image.length > 3_500_000) errors.image = "Photo must be smaller than 2.5 MB.";
	if (image && !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) errors.image = "Upload a JPEG, PNG, or WebP image.";
	if (alt.length > 180) errors.alt = "Photo description must be 180 characters or fewer.";

	return {
		errors,
		listing: {
			title,
			area,
			price,
			totalSpaces,
			availableSpaces,
			type,
			typeLabel: { private: "Private room", shared: "Shared room", studio: "Studio", apartment: "Entire apartment" }[type],
			details: details.length ? details : ["Accommodation listing"],
			image: image || "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=960&q=85",
			alt: alt || `Accommodation at ${title}`
		}
	};
}

function validateRequest(body) {
	const errors = {};
	const name = typeof body.name === "string" ? body.name.trim() : "";
	const email = typeof body.email === "string" ? body.email.trim() : "";
	const phone = typeof body.phone === "string" ? body.phone.trim() : "";
	const budget = Number(body.budget);
	const moveIn = typeof body.moveIn === "string" ? body.moveIn : "";
	const message = typeof body.message === "string" ? body.message.trim() : "";
	const facilities = Array.isArray(body.facilities) ? body.facilities : [];

	if (name.length < 2 || name.length > 80) errors.name = "Name must be between 2 and 80 characters.";
	if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email address.";
	if (!/^(?:\+260|0)?[0-9]{9}$/.test(phone.replace(/[\s()-]/g, ""))) errors.phone = "Enter a valid Zambian phone number.";
	if (body.campus !== "Mulungushi University") errors.campus = "University must be Mulungushi University.";
	if (!allowedRoomTypes.has(body.roomType)) errors.roomType = "Choose a valid room type.";
	if (!Number.isSafeInteger(budget) || budget < 1 || budget > 100000) errors.budget = "Budget must be a whole amount between K 1 and K 100,000.";
	if (!/^\d{4}-\d{2}-\d{2}$/.test(moveIn) || Number.isNaN(Date.parse(`${moveIn}T00:00:00Z`)) || moveIn < new Date().toISOString().slice(0, 10)) {
		errors.moveIn = "Choose a valid move-in date that is not in the past.";
	}
	if (message.length > 500) errors.message = "Message must be 500 characters or fewer.";
	if (facilities.length > allowedFacilities.size || facilities.some((facility) => !allowedFacilities.has(facility))) errors.facilities = "One or more facilities are invalid.";
	if (body.consent !== "on" && body.consent !== true) errors.consent = "Consent is required to save this request.";

	return {
		errors,
		request: { name, email, phone, campus: "Mulungushi University", roomType: body.roomType, budget, moveIn, facilities, message }
	};
}

function createApp({ db } = {}) {
	const database = db || createDatabase(path.join(__dirname, ".data", "accommodation.sqlite"));
	const app = express();
	const publicRoot = __dirname;

	app.disable("x-powered-by");
	app.use((req, res, next) => {
		const origin = req.get("Origin");
		const allowedOrigin = /^http:\/\/(?:localhost|127\.0\.0\.1):(?:3000|5500)$/.test(origin || "");

		if (origin) res.vary("Origin");
		if (allowedOrigin) {
			res.set("Access-Control-Allow-Origin", origin);
			res.set("Access-Control-Allow-Credentials", "true");
			res.set("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS");
			res.set("Access-Control-Allow-Headers", "Content-Type, X-Client-Id");
		}
		if (req.method === "OPTIONS" && req.get("Access-Control-Request-Method")) return res.sendStatus(204);

		next();
	});
	app.use(express.json({ limit: "5mb" }));
	app.use((req, res, next) => {
		res.set("X-Content-Type-Options", "nosniff");
		res.set("Referrer-Policy", "strict-origin-when-cross-origin");
		const token = getSessionToken(req.get("Cookie"));
		if (token) {
			const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
			const session = database.prepare(`
				SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
				WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.deleted_at IS NULL
			`).get(tokenHash, new Date().toISOString());
			if (session) req.user = session;
		}
		next();
	});

	app.get(["/", "/login.html"], (req, res) => res.sendFile(path.join(publicRoot, "login.html")));
	app.get("/registration.html", (req, res) => res.sendFile(path.join(publicRoot, "registration.html")));
	app.get("/style.css", (req, res) => res.sendFile(path.join(publicRoot, "style.css")));
	app.get(["/student", "/student.html"], (req, res) => res.sendFile(path.join(publicRoot, "student.html")));
	app.get(["/landlord", "/landlord.html"], (req, res) => res.sendFile(path.join(publicRoot, "landlord.html")));
	app.get(["/admin", "/admin.html"], (req, res) => res.sendFile(path.join(publicRoot, "admin.html")));
	app.get("/booking.html", (req, res) => res.sendFile(path.join(publicRoot, "booking.html")));
	app.get("/landingpage.html", (req, res) => res.sendFile(path.join(publicRoot, "landingpage.html")));
	app.get(["/terms-and-conditions.html", "/terms.html"], (req, res) => res.sendFile(path.join(publicRoot, "terms-and-conditions.html")));
	app.get(["/about-us.html", "/about.html"], (req, res) => res.sendFile(path.join(publicRoot, "about-us.html")));
	app.get("/portal.js", (req, res) => res.sendFile(path.join(publicRoot, "portal.js")));

	app.get("/api/health", (req, res) => {
		const databaseReady = database.prepare("SELECT 1 AS ready").get().ready === 1;
		res.status(databaseReady ? 200 : 503).json({ status: databaseReady ? "ok" : "unavailable", database: databaseReady ? "connected" : "disconnected" });
	});

	app.post("/api/auth/register", (req, res) => {
		if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) return res.status(400).json({ error: "A registration object is required." });
		const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
		const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
		const studentId = typeof req.body.studentId === "string" ? req.body.studentId.trim() : "";
		const phone = typeof req.body.phone === "string" ? req.body.phone.trim() : "";
		const password = typeof req.body.password === "string" ? req.body.password : "";
		const role = req.body.role;
		const errors = {};
		if (name.length < 2 || name.length > 80) errors.name = "Name must be between 2 and 80 characters.";
		if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email address.";
		if (role === "student" && (studentId.length < 2 || studentId.length > 50)) errors.studentId = "Enter a student ID between 2 and 50 characters.";
		if (!/^(?:\+260|0)?[0-9]{9}$/.test(phone.replace(/[\s()-]/g, ""))) errors.phone = "Enter a valid Zambian phone number.";
		if (password.length < 8 || password.length > 128) errors.password = "Password must be between 8 and 128 characters.";
		if (!["student", "landlord"].includes(role)) errors.role = "Choose student or landlord.";
		if (Object.keys(errors).length) return res.status(400).json({ error: "Please correct the highlighted fields.", fields: errors });
		if (database.prepare("SELECT id FROM users WHERE email = ?").get(email)) return res.status(409).json({ error: "An account with that email already exists.", fields: { email: "This email is already registered." } });
		if (role === "student" && database.prepare("SELECT id FROM users WHERE student_id = ? COLLATE NOCASE").get(studentId)) {
			return res.status(409).json({ error: "This student ID is already registered.", fields: { studentId: "This student ID is already registered." } });
		}

		const userId = crypto.randomUUID();
		const salt = crypto.randomBytes(16).toString("hex");
		try {
			database.prepare(`
				INSERT INTO users (id, name, email, student_id, phone, role, verified, password_salt, password_hash)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			`).run(userId, name, email, role === "student" ? studentId : null, phone, role, role === "student" ? 1 : 0, salt, hashPassword(password, salt));
		} catch (error) {
			if (error.code === "SQLITE_CONSTRAINT_UNIQUE" && role === "student") {
				return res.status(409).json({ error: "This student ID is already registered.", fields: { studentId: "This student ID is already registered." } });
			}
			throw error;
		}
		logActivity(database, userId, "account.registered", `${role} account registered: ${email}`);
		const user = database.prepare("SELECT * FROM users WHERE id = ?").get(userId);
		issueSession(database, userId, res);
		res.status(201).json({ user: safeUser(user) });
	});

	app.post("/api/auth/login", (req, res) => {
		const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
		const password = typeof req.body?.password === "string" ? req.body.password : "";
		const user = database.prepare("SELECT * FROM users WHERE email = ? AND deleted_at IS NULL").get(email);
		if (!user || !passwordMatches(password, user.password_salt, user.password_hash)) return res.status(401).json({ error: "Email or password is incorrect." });
		issueSession(database, user.id, res);
		logActivity(database, user.id, "account.signed_in", `${user.role} account signed in`);
		res.json({ user: safeUser(user) });
	});

	app.post("/api/auth/logout", (req, res) => {
		const token = getSessionToken(req.get("Cookie"));
		if (token) database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(crypto.createHash("sha256").update(token).digest("hex"));
		clearSessionCookie(res);
		res.json({ ok: true });
	});

	app.get("/api/auth/me", (req, res) => {
		res.json({ user: req.user ? safeUser(req.user) : null });
	});

	app.patch("/api/account/student-id", requireRole("student"), (req, res) => {
		if (req.user.student_id) return res.status(409).json({ error: "Your student ID has already been saved." });
		const studentId = typeof req.body?.studentId === "string" ? req.body.studentId.trim() : "";
		if (studentId.length < 2 || studentId.length > 50) return res.status(400).json({ error: "Enter a student ID between 2 and 50 characters." });
		try {
			database.prepare("UPDATE users SET student_id = ? WHERE id = ? AND student_id IS NULL").run(studentId, req.user.id);
		} catch (error) {
			if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "This student ID is already registered." });
			throw error;
		}
		logActivity(database, req.user.id, "student.id_added", "Student ID added to account");
		res.json({ user: safeUser(database.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id)) });
	});

	app.put("/api/account/password", requireRole(), (req, res) => {
		const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
		const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
		if (!passwordMatches(currentPassword, req.user.password_salt, req.user.password_hash)) return res.status(400).json({ error: "Current password is incorrect." });
		if (newPassword.length < 8 || newPassword.length > 128) return res.status(400).json({ error: "New password must be between 8 and 128 characters." });
		const salt = crypto.randomBytes(16).toString("hex");
		database.prepare("UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ?").run(salt, hashPassword(newPassword, salt), req.user.id);
		const currentToken = getSessionToken(req.get("Cookie"));
		if (currentToken) {
			const currentTokenHash = crypto.createHash("sha256").update(currentToken).digest("hex");
			database.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(req.user.id, currentTokenHash);
		}
		logActivity(database, req.user.id, "account.password_changed", `${req.user.role} account changed its password`);
		res.json({ message: "Password updated." });
	});

	app.get("/api/listings", (req, res) => {
		const records = database.prepare(`
			SELECT id, title, area, campus, type, type_label AS typeLabel, price_zmw AS price,
				details_json AS detailsJson, commute, availability, tag, image, alt,
				total_spaces AS totalSpaces, available_spaces AS availableSpaces, occupancy_status AS occupancyStatus
			FROM listings WHERE status = 'approved' ORDER BY display_order, title
		`).all();
		res.json(records.map(({ detailsJson, ...listing }) => ({ ...listing, details: JSON.parse(detailsJson) })));
	});

	app.post("/api/listings", requireRole("landlord"), (req, res) => {
		if (!req.user.verified) return res.status(403).json({ error: "Your landlord account must be verified before you can publish a place." });
		const { errors, listing } = validateListing(req.body || {});
		if (Object.keys(errors).length) return res.status(400).json({ error: "Please correct the highlighted fields.", fields: errors });
		const id = crypto.randomUUID();
		database.prepare(`
			INSERT INTO listings (
				id, title, area, campus, type, type_label, price_zmw, details_json, commute, availability, tag, image, alt,
				created_by, status, created_at, total_spaces, available_spaces, occupancy_status
			) VALUES (
				?, ?, ?, 'Mulungushi University', ?, ?, ?, ?, 'Confirm route to campus', 'Available', 'Awaiting review', ?, ?, ?, 'pending', CURRENT_TIMESTAMP, ?, ?, ?
			)
		`).run(id, listing.title, listing.area, listing.type, listing.typeLabel, listing.price, JSON.stringify(listing.details), listing.image, listing.alt, req.user.id, listing.totalSpaces, listing.availableSpaces, listing.availableSpaces > 0 ? "available" : "full");
		logActivity(database, req.user.id, "listing.submitted", `Listing submitted for approval: ${listing.title}`);
		res.status(201).json({ id, status: "pending", message: "Your listing was submitted for admin review." });
	});

	app.get("/api/my-listings", requireRole("landlord"), (req, res) => {
		const listings = database.prepare(`
			SELECT id, title, area, type_label AS typeLabel, price_zmw AS price, image, alt, status,
				total_spaces AS totalSpaces, available_spaces AS availableSpaces, occupancy_status AS occupancyStatus,
				created_at AS createdAt
			FROM listings WHERE created_by = ? ORDER BY created_at DESC
		`).all(req.user.id);
		res.json(listings);
	});

	app.patch("/api/my-listings/:listingId", requireRole("landlord"), (req, res) => {
		const listing = database.prepare("SELECT * FROM listings WHERE id = ? AND created_by = ?").get(req.params.listingId, req.user.id);
		if (!listing) return res.status(404).json({ error: "Your listing was not found." });
		const price = req.body?.price === undefined ? listing.price_zmw : Number(req.body.price);
		const totalSpaces = req.body?.totalSpaces === undefined ? listing.total_spaces : Number(req.body.totalSpaces);
		const availableSpaces = req.body?.availableSpaces === undefined ? listing.available_spaces : Number(req.body.availableSpaces);
		const image = req.body?.image === undefined ? listing.image : req.body.image;
		const alt = req.body?.alt === undefined ? listing.alt : (typeof req.body.alt === "string" ? req.body.alt.trim() : "");
		const occupiedCount = database.prepare("SELECT COUNT(*) AS count FROM bookings WHERE listing_id = ? AND status = 'accepted'").get(listing.id).count;
		if (!Number.isSafeInteger(price) || price < 1 || price > 100000) return res.status(400).json({ error: "Monthly rent must be a whole amount from K 1 to K 100,000." });
		if (!Number.isSafeInteger(totalSpaces) || totalSpaces < 1 || totalSpaces > 1000 || totalSpaces < occupiedCount) return res.status(400).json({ error: "Total spaces must be at least the number of accepted bookings and no more than 1,000." });
		if (!Number.isSafeInteger(availableSpaces) || availableSpaces < 0 || availableSpaces > totalSpaces - occupiedCount) return res.status(400).json({ error: "Available spaces must be between zero and total spaces minus accepted bookings." });
		if (typeof image !== "string" || image.length > 3_500_000 || (image !== listing.image && !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image))) return res.status(400).json({ error: "Upload a JPEG, PNG, or WebP image smaller than 2.5 MB." });
		if (typeof alt !== "string" || alt.length > 180) return res.status(400).json({ error: "Photo description must be 180 characters or fewer." });
		const occupancyStatus = listing.occupancy_status === "pending_review" ? "pending_review" : (availableSpaces === 0 ? "full" : "available");
		database.prepare(`
			UPDATE listings SET price_zmw = ?, total_spaces = ?, available_spaces = ?, image = ?, alt = ?, occupancy_status = ? WHERE id = ?
		`).run(price, totalSpaces, availableSpaces, image, alt, occupancyStatus, listing.id);
		logActivity(database, req.user.id, "listing.updated", `Updated ${listing.title}: rent and/or spaces and/or photo`);
		res.json({ id: listing.id, price, totalSpaces, availableSpaces, occupancyStatus, message: "Listing updated." });
	});

	app.post("/api/my-listings/:listingId/full-requests", requireRole("landlord"), (req, res) => {
		const listing = database.prepare("SELECT id, title, occupancy_status FROM listings WHERE id = ? AND created_by = ?").get(req.params.listingId, req.user.id);
		if (!listing) return res.status(404).json({ error: "Your listing was not found." });
		if (listing.occupancy_status === "full") return res.status(409).json({ error: "This place is already marked full." });
		const previousRequest = database.prepare("SELECT id FROM landlord_full_requests WHERE listing_id = ? AND status = 'pending'").get(listing.id);
		if (previousRequest) return res.status(409).json({ error: "A full-capacity request is already awaiting admin review." });
		const createRequest = database.transaction(() => {
			const result = database.prepare("INSERT INTO landlord_full_requests (listing_id, landlord_id) VALUES (?, ?)").run(listing.id, req.user.id);
			database.prepare("UPDATE listings SET occupancy_status = 'pending_review' WHERE id = ?").run(listing.id);
			logActivity(database, req.user.id, "listing.full_requested", `Reported ${listing.title} full; admin confirmation requested`);
			return result.lastInsertRowid;
		});
		res.status(201).json({ id: createRequest(), status: "pending", message: "Full-capacity request sent to the administrator. New booking requests are paused until review." });
	});

	app.post("/api/bookings", requireRole("student"), (req, res) => {
		if (!req.user.verified) return res.status(403).json({ error: "Your student account is not active." });
		if (!req.user.student_id) return res.status(400).json({ error: "Add your student ID to your account before requesting accommodation." });
		const listingId = typeof req.body?.listingId === "string" ? req.body.listingId : "";
		const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
		if (message.length > 500) return res.status(400).json({ error: "Booking message must be 500 characters or fewer." });
		const listing = database.prepare("SELECT id, title, available_spaces, occupancy_status FROM listings WHERE id = ? AND status = 'approved'").get(listingId);
		if (!listing) return res.status(404).json({ error: "This accommodation is not available for booking." });
		if (listing.available_spaces < 1 || listing.occupancy_status !== "available") return res.status(409).json({ error: "This accommodation currently has no bookable spaces." });
		try {
			const result = database.prepare("INSERT INTO bookings (student_id, listing_id, message) VALUES (?, ?, ?)").run(req.user.id, listing.id, message);
			logActivity(database, req.user.id, "booking.created", `Booking request created for ${listing.title}`);
			res.status(201).json({ id: result.lastInsertRowid, status: "pending", message: "Your booking request was sent." });
		} catch (error) {
			if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "You already have a booking request for this place." });
			throw error;
		}
	});

	app.get("/api/bookings", requireRole("student", "landlord", "admin"), (req, res) => {
		let query = `
			SELECT bookings.id, bookings.message, bookings.status, bookings.created_at AS createdAt,
				listings.id AS listingId, listings.title AS listingTitle, listings.area,
				listings.total_spaces AS totalSpaces, listings.available_spaces AS availableSpaces,
				users.name AS studentName, users.email AS studentEmail, users.student_id AS studentId,
				bookings.tenancy_status AS tenancyStatus, bookings.accepted_at AS acceptedAt,
				bookings.rent_due_day AS rentDueDay
			FROM bookings
			JOIN listings ON listings.id = bookings.listing_id
			JOIN users ON users.id = bookings.student_id
		`;
		const params = [];
		if (req.user.role === "student") {
			query += " WHERE bookings.student_id = ?";
			params.push(req.user.id);
		} else if (req.user.role === "landlord") {
			query += " WHERE listings.created_by = ?";
			params.push(req.user.id);
		}
		query += " ORDER BY bookings.created_at DESC";
		const bookings = database.prepare(query).all(...params);
		const payments = database.prepare(`
			SELECT rent_month AS rentMonth, paid_on AS paidOn, amount_zmw AS amountZmw
			FROM rent_payments WHERE booking_id = ? ORDER BY rent_month DESC
		`);
		res.json(bookings.map((booking) => {
			const bookingPayments = payments.all(booking.id);
			const bookingWithPayments = { ...booking, payments: bookingPayments };
			return {
				...bookingWithPayments,
				...getRentSummary({
					rentDueDay: booking.rentDueDay,
					acceptedAt: booking.acceptedAt,
					createdAt: booking.createdAt,
					payments: bookingPayments
				})
			};
		}));
	});

	app.patch("/api/bookings/:bookingId", requireRole("landlord", "admin"), (req, res) => {
		const status = req.body?.status;
		if (!["accepted", "declined"].includes(status)) return res.status(400).json({ error: "Choose accepted or declined." });
		const booking = database.prepare(`
			SELECT bookings.id, bookings.status, listings.id AS listingId, listings.title, listings.created_by
			FROM bookings JOIN listings ON listings.id = bookings.listing_id WHERE bookings.id = ?
		`).get(req.params.bookingId);
		if (!booking) return res.status(404).json({ error: "Booking request not found." });
		if (req.user.role === "landlord" && booking.created_by !== req.user.id) return res.status(403).json({ error: "You can only update requests for your own listings." });
		if (booking.status !== "pending") return res.status(409).json({ error: "This booking request has already been answered." });
		const updateBooking = database.transaction(() => {
			const updateResult = database.prepare(`
				UPDATE bookings SET status = ?, tenancy_status = ?, accepted_at = CASE WHEN ? = 'accepted' THEN CURRENT_TIMESTAMP ELSE accepted_at END
				WHERE id = ? AND status = 'pending'
			`).run(status, status === "accepted" ? "accommodating" : "pending", status, booking.id);
			if (updateResult.changes !== 1) {
				const error = new Error("This booking request has already been answered.");
				error.status = 409;
				throw error;
			}
			if (status === "accepted") {
				const capacity = database.prepare("SELECT available_spaces, occupancy_status FROM listings WHERE id = ?").get(booking.listingId);
				if (!capacity || capacity.available_spaces < 1 || capacity.occupancy_status !== "available") {
					const error = new Error("No spaces remain available for this accommodation.");
					error.status = 409;
					throw error;
				}
				database.prepare(`
					UPDATE listings SET available_spaces = available_spaces - 1,
						occupancy_status = CASE WHEN available_spaces <= 1 THEN 'full' ELSE 'available' END
					WHERE id = ?
				`).run(booking.listingId);
			}
		});
		try {
			updateBooking();
		} catch (error) {
			if (error.status === 409) return res.status(409).json({ error: error.message });
			throw error;
		}
		logActivity(database, req.user.id, `booking.${status}`, `Booking for ${booking.title} was ${status}`);
		res.json({ id: booking.id, status });
	});

	app.patch("/api/landlord/bookings/:bookingId/rent-schedule", requireRole("landlord"), (req, res) => {
		const dueDay = Number(req.body?.dueDay);
		if (!Number.isSafeInteger(dueDay) || dueDay < 1 || dueDay > 28) return res.status(400).json({ error: "Choose a monthly rent due day from 1 to 28." });
		const booking = database.prepare(`
			SELECT bookings.id, bookings.tenancy_status, listings.title, listings.created_by
			FROM bookings JOIN listings ON listings.id = bookings.listing_id WHERE bookings.id = ?
		`).get(req.params.bookingId);
		if (!booking) return res.status(404).json({ error: "Accommodation record not found." });
		if (booking.created_by !== req.user.id) return res.status(403).json({ error: "You can only manage rent for students in your own houses." });
		if (booking.tenancy_status !== "accommodating") return res.status(400).json({ error: "Rent schedules can only be set for current residents." });
		database.prepare("UPDATE bookings SET rent_due_day = ? WHERE id = ?").run(dueDay, booking.id);
		logActivity(database, req.user.id, "rent.schedule_set", `Set rent due day ${dueDay} for ${booking.title}`);
		res.json({ bookingId: booking.id, dueDay });
	});

	app.post("/api/landlord/bookings/:bookingId/payments", requireRole("landlord"), (req, res) => {
		const paidOn = req.body?.paidOn;
		const rentMonth = req.body?.rentMonth;
		if (!isValidDate(paidOn) || paidOn > new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: "Enter a valid payment date that is not in the future." });
		if (typeof rentMonth !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(rentMonth)) return res.status(400).json({ error: "Choose the rent month this payment covers." });
		const booking = database.prepare(`
			SELECT bookings.id, bookings.tenancy_status, listings.title, listings.price_zmw, listings.created_by
			FROM bookings JOIN listings ON listings.id = bookings.listing_id WHERE bookings.id = ?
		`).get(req.params.bookingId);
		if (!booking) return res.status(404).json({ error: "Accommodation record not found." });
		if (booking.created_by !== req.user.id) return res.status(403).json({ error: "You can only record payments for residents in your own houses." });
		if (booking.tenancy_status !== "accommodating") return res.status(400).json({ error: "Payments can only be recorded for current residents." });
		try {
			const result = database.prepare(`
				INSERT INTO rent_payments (booking_id, rent_month, paid_on, amount_zmw, recorded_by)
				VALUES (?, ?, ?, ?, ?)
			`).run(booking.id, rentMonth, paidOn, booking.price_zmw, req.user.id);
			logActivity(database, req.user.id, "rent.payment_recorded", `Recorded K ${booking.price_zmw} rent for ${booking.title}, ${rentMonth}, paid ${paidOn}`);
			res.status(201).json({ id: result.lastInsertRowid, rentMonth, paidOn, amountZmw: booking.price_zmw });
		} catch (error) {
			if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "A rent payment is already recorded for that student and month." });
			throw error;
		}
	});

	app.post("/api/landlord/bookings/:bookingId/removal-requests", requireRole("landlord"), (req, res) => {
		const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
		if (reason.length < 5 || reason.length > 500) return res.status(400).json({ error: "Explain the removal request in 5 to 500 characters." });
		const booking = database.prepare(`
			SELECT bookings.id, bookings.tenancy_status, users.name AS student_name, listings.title, listings.created_by
			FROM bookings JOIN listings ON listings.id = bookings.listing_id
			JOIN users ON users.id = bookings.student_id WHERE bookings.id = ?
		`).get(req.params.bookingId);
		if (!booking) return res.status(404).json({ error: "Accommodation record not found." });
		if (booking.created_by !== req.user.id) return res.status(403).json({ error: "You can only request removal from your own houses." });
		if (booking.tenancy_status !== "accommodating") return res.status(400).json({ error: "Only current residents can be referred for removal." });
		const pending = database.prepare("SELECT id FROM landlord_removal_requests WHERE booking_id = ? AND status = 'pending'").get(booking.id);
		if (pending) return res.status(409).json({ error: "A removal request is already awaiting admin review." });
		const result = database.prepare("INSERT INTO landlord_removal_requests (booking_id, landlord_id, reason) VALUES (?, ?, ?)").run(booking.id, req.user.id, reason);
		logActivity(database, req.user.id, "resident.removal_requested", `Requested admin review to remove ${booking.student_name} from ${booking.title}`);
		res.status(201).json({ id: result.lastInsertRowid, status: "pending", message: "Removal request sent to the administrator for review." });
	});

	app.get("/api/landlord/records", requireRole("landlord"), (req, res) => {
		const records = database.prepare(`
			SELECT listings.id AS listingId, listings.title AS listingTitle, listings.area,
				bookings.id AS bookingId, bookings.status AS bookingStatus,
				bookings.tenancy_status AS tenancyStatus, bookings.rent_due_day AS rentDueDay,
				bookings.accepted_at AS acceptedAt, bookings.created_at AS createdAt,
				users.id AS studentUserId, users.student_id AS studentNumber, users.name AS studentName, users.email AS studentEmail,
				landlord_removal_requests.status AS removalStatus
			FROM listings
			LEFT JOIN bookings ON bookings.listing_id = listings.id
			LEFT JOIN users ON users.id = bookings.student_id
			LEFT JOIN landlord_removal_requests ON landlord_removal_requests.booking_id = bookings.id
				AND landlord_removal_requests.status = 'pending'
			WHERE listings.created_by = ?
			ORDER BY listings.created_at DESC, bookings.created_at DESC
		`).all(req.user.id);
		const paymentStatement = database.prepare(`
			SELECT rent_month AS rentMonth, paid_on AS paidOn, amount_zmw AS amountZmw
			FROM rent_payments WHERE booking_id = ? ORDER BY rent_month DESC
		`);
		res.json(records.map((record) => {
			if (!record.bookingId) return record;
			const payments = paymentStatement.all(record.bookingId);
			return {
				...record,
				payments,
				...getRentSummary({
					rentDueDay: record.rentDueDay,
					acceptedAt: record.acceptedAt,
					createdAt: record.createdAt,
					payments
				})
			};
		}));
	});

	app.get("/api/admin/users", requireRole("admin"), (req, res) => {
		res.json(database.prepare("SELECT id, name, email, student_id, phone, role, verified, created_at, deleted_at FROM users ORDER BY created_at DESC").all().map(safeUser));
	});

	app.post("/api/admin/users", requireRole("admin"), (req, res) => {
		const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
		const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
		const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
		const password = typeof req.body?.password === "string" ? req.body.password : "";
		const errors = {};
		if (name.length < 2 || name.length > 80) errors.name = "Name must be between 2 and 80 characters.";
		if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email address.";
		if (phone && !/^(?:\+260|0)?[0-9]{9}$/.test(phone.replace(/[\s()-]/g, ""))) errors.phone = "Enter a valid Zambian phone number.";
		if (password.length < 12 || password.length > 128) errors.password = "Admin password must be between 12 and 128 characters.";
		if (Object.keys(errors).length) return res.status(400).json({ error: "Please correct the highlighted fields.", fields: errors });
		if (database.prepare("SELECT id FROM users WHERE email = ?").get(email)) return res.status(409).json({ error: "An account with that email already exists." });
		const userId = crypto.randomUUID();
		const salt = crypto.randomBytes(16).toString("hex");
		database.prepare(`
			INSERT INTO users (id, name, email, phone, role, verified, password_salt, password_hash)
			VALUES (?, ?, ?, ?, 'admin', 1, ?, ?)
		`).run(userId, name, email, phone, salt, hashPassword(password, salt));
		logActivity(database, req.user.id, "admin.created", `Administrator account created: ${email}`);
		res.status(201).json({ user: safeUser(database.prepare("SELECT * FROM users WHERE id = ?").get(userId)) });
	});

	app.patch("/api/admin/users/:userId", requireRole("admin"), (req, res) => {
		const user = database.prepare("SELECT * FROM users WHERE id = ?").get(req.params.userId);
		if (!user) return res.status(404).json({ error: "User not found." });
		if (user.deleted_at) return res.status(410).json({ error: "Deleted accounts cannot be changed." });
		const role = req.body?.role ?? user.role;
		const verified = req.body?.verified === undefined ? Boolean(user.verified) : req.body.verified;
		if (!["student", "landlord", "admin"].includes(role) || typeof verified !== "boolean") return res.status(400).json({ error: "Choose a valid role and verification status." });
		if (user.id === req.user.id && role !== "admin") return res.status(400).json({ error: "You cannot remove your own administrator role." });
		if (user.deleted_at) return res.status(410).json({ error: "Deleted accounts cannot be changed." });
		if (user.role === "admin" && role !== "admin" && database.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND deleted_at IS NULL").get().count < 2) {
			return res.status(400).json({ error: "At least one administrator account must remain." });
		}
		if (role === "landlord" && user.role !== "landlord") {
			database.prepare("UPDATE users SET role = ?, verified = ? WHERE id = ?").run(role, Number(verified), user.id);
		} else {
			database.prepare("UPDATE users SET role = ?, verified = ? WHERE id = ?").run(role, role === "student" ? 1 : Number(verified), user.id);
		}
		if (user.role === "landlord" && role !== "landlord") {
			database.prepare("UPDATE listings SET status = 'rejected' WHERE created_by = ?").run(user.id);
		}
		logActivity(database, req.user.id, "user.updated", `Updated ${user.email}: role=${role}, verified=${verified}`);
		res.json({ user: safeUser(database.prepare("SELECT * FROM users WHERE id = ?").get(user.id)) });
	});

	app.delete("/api/admin/users/:userId", requireRole("admin"), (req, res) => {
		const user = database.prepare("SELECT * FROM users WHERE id = ?").get(req.params.userId);
		if (!user) return res.status(404).json({ error: "User not found." });
		if (user.deleted_at) return res.status(410).json({ error: "This account has already been deleted." });
		if (user.id === req.user.id) return res.status(400).json({ error: "You cannot delete the administrator account you are currently using." });
		if (user.role === "admin" && database.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND deleted_at IS NULL").get().count < 2) {
			return res.status(400).json({ error: "At least one active administrator account must remain." });
		}
		const deleteUser = database.transaction(() => {
			if (user.role === "student") {
				const activeListings = database.prepare(`
					SELECT listings.id, listings.available_spaces, listings.total_spaces, listings.occupancy_status
					FROM bookings JOIN listings ON listings.id = bookings.listing_id
					WHERE bookings.student_id = ? AND bookings.tenancy_status = 'accommodating'
				`).all(user.id);
				database.prepare("UPDATE bookings SET tenancy_status = 'removed' WHERE student_id = ? AND tenancy_status = 'accommodating'").run(user.id);
				const restoreCapacity = database.prepare(`
					UPDATE listings SET available_spaces = MIN(total_spaces, available_spaces + 1),
						occupancy_status = CASE WHEN occupancy_status = 'pending_review' THEN 'pending_review'
							WHEN available_spaces + 1 > 0 THEN 'available' ELSE 'full' END
					WHERE id = ?
				`);
				activeListings.forEach((listing) => restoreCapacity.run(listing.id));
			}
			if (user.role === "landlord") {
				database.prepare("UPDATE listings SET status = 'rejected' WHERE created_by = ?").run(user.id);
			}
			database.prepare("UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(user.id);
			database.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
			logActivity(database, req.user.id, "user.deleted", `Account deactivated and records retained: ${user.role} ${user.email}`);
		});
		deleteUser();
		res.json({ id: user.id, deleted: true, recordsRetained: true });
	});

	app.get("/api/admin/records", requireRole("admin"), (req, res) => {
		const records = database.prepare(`
			SELECT listings.id AS listingId, listings.title AS listingTitle, listings.area,
				listings.price_zmw AS price, listings.total_spaces AS totalSpaces,
				listings.available_spaces AS availableSpaces, listings.status AS listingStatus,
				listings.occupancy_status AS occupancyStatus,
				landlords.id AS landlordId, landlords.name AS landlordName, landlords.email AS landlordEmail,
				bookings.id AS bookingId, bookings.status AS bookingStatus,
				bookings.tenancy_status AS tenancyStatus, bookings.rent_due_day AS rentDueDay,
				bookings.accepted_at AS acceptedAt, bookings.created_at AS createdAt,
				students.id AS studentUserId, students.student_id AS studentId, students.name AS studentName, students.email AS studentEmail,
				removal_requests.status AS removalStatus
			FROM listings
			LEFT JOIN users AS landlords ON landlords.id = listings.created_by
			LEFT JOIN bookings ON bookings.listing_id = listings.id
			LEFT JOIN users AS students ON students.id = bookings.student_id
			LEFT JOIN landlord_removal_requests AS removal_requests ON removal_requests.booking_id = bookings.id
				AND removal_requests.status = 'pending'
			WHERE listings.created_by IS NOT NULL
			ORDER BY listings.created_at DESC, bookings.created_at DESC
		`).all();
		const paymentStatement = database.prepare(`
			SELECT rent_month AS rentMonth, paid_on AS paidOn, amount_zmw AS amountZmw
			FROM rent_payments WHERE booking_id = ? ORDER BY rent_month DESC
		`);
		res.json(records.map((record) => {
			if (!record.bookingId) return record;
			const payments = paymentStatement.all(record.bookingId);
			return {
				...record,
				payments,
				...getRentSummary({
					rentDueDay: record.rentDueDay,
					acceptedAt: record.acceptedAt,
					createdAt: record.createdAt,
					payments
				})
			};
		}));
	});

	app.get("/api/admin/removal-requests", requireRole("admin"), (req, res) => {
		res.json(database.prepare(`
			SELECT landlord_removal_requests.id, landlord_removal_requests.reason,
				landlord_removal_requests.status, landlord_removal_requests.created_at AS createdAt,
				bookings.id AS bookingId, landlords.name AS landlordName, landlords.email AS landlordEmail,
				students.student_id AS studentId, students.name AS studentName, students.email AS studentEmail,
				listings.title AS listingTitle, listings.area
			FROM landlord_removal_requests
			JOIN bookings ON bookings.id = landlord_removal_requests.booking_id
			JOIN users AS landlords ON landlords.id = landlord_removal_requests.landlord_id
			JOIN users AS students ON students.id = bookings.student_id
			JOIN listings ON listings.id = bookings.listing_id
			ORDER BY CASE landlord_removal_requests.status WHEN 'pending' THEN 0 ELSE 1 END, landlord_removal_requests.created_at DESC
		`).all());
	});

	app.patch("/api/admin/removal-requests/:requestId", requireRole("admin"), (req, res) => {
		const decision = req.body?.decision;
		if (!["approved", "declined"].includes(decision)) return res.status(400).json({ error: "Choose approved or declined." });
		const request = database.prepare(`
			SELECT landlord_removal_requests.id, landlord_removal_requests.status, bookings.id AS bookingId,
				bookings.tenancy_status, listings.id AS listingId, listings.title, users.name AS studentName
			FROM landlord_removal_requests
			JOIN bookings ON bookings.id = landlord_removal_requests.booking_id
			JOIN listings ON listings.id = bookings.listing_id
			JOIN users ON users.id = bookings.student_id
			WHERE landlord_removal_requests.id = ?
		`).get(req.params.requestId);
		if (!request) return res.status(404).json({ error: "Removal request not found." });
		if (request.status !== "pending") return res.status(409).json({ error: "This removal request has already been reviewed." });
		const resolveRequest = database.transaction(() => {
			const update = database.prepare(`
				UPDATE landlord_removal_requests SET status = ?, resolved_at = CURRENT_TIMESTAMP, resolved_by = ?
				WHERE id = ? AND status = 'pending'
			`).run(decision, req.user.id, request.id);
			if (update.changes !== 1) {
				const error = new Error("This removal request has already been reviewed.");
				error.status = 409;
				throw error;
			}
			if (decision === "approved" && request.tenancy_status === "accommodating") {
				database.prepare("UPDATE bookings SET tenancy_status = 'removed' WHERE id = ?").run(request.bookingId);
				database.prepare(`
					UPDATE listings SET available_spaces = MIN(total_spaces, available_spaces + 1),
						occupancy_status = CASE WHEN occupancy_status = 'pending_review' THEN 'pending_review'
							WHEN available_spaces + 1 > 0 THEN 'available' ELSE 'full' END
					WHERE id = ?
				`).run(request.listingId);
			}
			logActivity(database, req.user.id, `resident.removal_${decision}`, `${request.studentName} removal request for ${request.title} was ${decision}`);
		});
		try {
			resolveRequest();
		} catch (error) {
			if (error.status === 409) return res.status(409).json({ error: error.message });
			throw error;
		}
		res.json({ id: request.id, status: decision });
	});

	app.get("/api/admin/listings", requireRole("admin"), (req, res) => {
		res.json(database.prepare(`
			SELECT listings.id, listings.title, listings.area, listings.status, listings.occupancy_status AS occupancyStatus,
				listings.total_spaces AS totalSpaces, listings.available_spaces AS availableSpaces,
				listings.created_at AS createdAt,
				users.name AS landlordName, users.email AS landlordEmail
			FROM listings LEFT JOIN users ON users.id = listings.created_by
			WHERE listings.created_by IS NOT NULL ORDER BY listings.created_at DESC
		`).all());
	});

	app.get("/api/admin/full-requests", requireRole("admin"), (req, res) => {
		res.json(database.prepare(`
			SELECT landlord_full_requests.id, landlord_full_requests.status,
				landlord_full_requests.created_at AS createdAt,
				listings.id AS listingId, listings.title AS listingTitle, listings.area,
				users.name AS landlordName, users.email AS landlordEmail
			FROM landlord_full_requests
			JOIN listings ON listings.id = landlord_full_requests.listing_id
			JOIN users ON users.id = landlord_full_requests.landlord_id
			ORDER BY CASE landlord_full_requests.status WHEN 'pending' THEN 0 ELSE 1 END, landlord_full_requests.created_at DESC
		`).all());
	});

	app.patch("/api/admin/full-requests/:requestId", requireRole("admin"), (req, res) => {
		const decision = req.body?.decision;
		if (!["confirmed", "declined"].includes(decision)) return res.status(400).json({ error: "Choose confirmed or declined." });
		const fullRequest = database.prepare(`
			SELECT landlord_full_requests.id, landlord_full_requests.status, listings.id AS listingId, listings.title
			FROM landlord_full_requests
			JOIN listings ON listings.id = landlord_full_requests.listing_id
			WHERE landlord_full_requests.id = ?
		`).get(req.params.requestId);
		if (!fullRequest) return res.status(404).json({ error: "Full-capacity request not found." });
		if (fullRequest.status !== "pending") return res.status(409).json({ error: "This full-capacity request has already been reviewed." });
		const resolve = database.transaction(() => {
			database.prepare("UPDATE landlord_full_requests SET status = ?, resolved_at = CURRENT_TIMESTAMP, resolved_by = ? WHERE id = ? AND status = 'pending'").run(decision, req.user.id, fullRequest.id);
			if (decision === "confirmed") {
				database.prepare("UPDATE listings SET available_spaces = 0, occupancy_status = 'full' WHERE id = ?").run(fullRequest.listingId);
			} else {
				database.prepare(`
					UPDATE listings SET occupancy_status = CASE WHEN available_spaces > 0 THEN 'available' ELSE 'full' END
					WHERE id = ?
				`).run(fullRequest.listingId);
			}
			logActivity(database, req.user.id, `listing.full_${decision}`, `Full-capacity report for ${fullRequest.title} was ${decision}`);
		});
		resolve();
		res.json({ id: fullRequest.id, status: decision });
	});

	app.patch("/api/admin/listings/:listingId", requireRole("admin"), (req, res) => {
		if (!["approved", "rejected"].includes(req.body?.status)) return res.status(400).json({ error: "Choose approved or rejected." });
		const listing = database.prepare(`
			SELECT listings.id, listings.title, users.verified
			FROM listings LEFT JOIN users ON users.id = listings.created_by
			WHERE listings.id = ? AND listings.created_by IS NOT NULL
		`).get(req.params.listingId);
		if (!listing) return res.status(404).json({ error: "Landlord listing not found." });
		if (req.body.status === "approved" && !listing.verified) return res.status(400).json({ error: "Verify the landlord account before approving this listing." });
		database.prepare(`
			UPDATE listings SET status = ?, tag = CASE WHEN ? = 'approved' THEN 'Verified landlord' ELSE tag END WHERE id = ?
		`).run(req.body.status, req.body.status, listing.id);
		logActivity(database, req.user.id, `listing.${req.body.status}`, `Listing ${listing.title} was ${req.body.status}`);
		res.json({ id: listing.id, status: req.body.status });
	});

	app.get("/api/admin/logs", requireRole("admin"), (req, res) => {
		res.json(database.prepare(`
			SELECT activity_logs.id, activity_logs.action, activity_logs.details, activity_logs.created_at AS createdAt,
				COALESCE(users.name, 'System') AS actorName
			FROM activity_logs LEFT JOIN users ON users.id = activity_logs.actor_id
			ORDER BY activity_logs.id DESC LIMIT 200
		`).all());
	});

	app.get("/api/favorites", (req, res) => {
		const clientId = req.get("X-Client-Id");
		if (!clientIdPattern.test(clientId || "")) return res.status(400).json({ error: "A valid client ID is required." });
		const favorites = database.prepare("SELECT listing_id AS listingId FROM saved_listings WHERE client_id = ? ORDER BY created_at").all(clientId);
		res.json(favorites.map((favorite) => favorite.listingId));
	});

	app.put("/api/favorites/:listingId", (req, res) => {
		const clientId = req.get("X-Client-Id");
		if (!clientIdPattern.test(clientId || "")) return res.status(400).json({ error: "A valid client ID is required." });
		if (typeof req.body?.saved !== "boolean") return res.status(400).json({ error: "The saved field must be true or false." });
		const listing = database.prepare("SELECT id FROM listings WHERE id = ?").get(req.params.listingId);
		if (!listing) return res.status(404).json({ error: "Listing not found." });

		if (req.body.saved) {
			database.prepare("INSERT OR IGNORE INTO saved_listings (client_id, listing_id) VALUES (?, ?)").run(clientId, listing.id);
		} else {
			database.prepare("DELETE FROM saved_listings WHERE client_id = ? AND listing_id = ?").run(clientId, listing.id);
		}
		res.json({ listingId: listing.id, saved: req.body.saved });
	});

	app.post("/api/requests", (req, res) => {
		if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) return res.status(400).json({ error: "A request object is required." });
		const { errors, request } = validateRequest(req.body);
		if (Object.keys(errors).length) return res.status(400).json({ error: "Please correct the highlighted fields.", fields: errors });

		const result = database.prepare(`
			INSERT INTO accommodation_requests (
				name, email, phone, campus, room_type, budget_zmw, move_in, facilities_json, message
			) VALUES (
				@name, @email, @phone, @campus, @roomType, @budget, @moveIn, @facilities, @message
			)
		`).run({ ...request, facilities: JSON.stringify(request.facilities) });
		res.status(201).json({ id: result.lastInsertRowid, message: "Your request has been saved." });
	});

	app.use("/api", (req, res) => res.status(404).json({ error: "API endpoint not found." }));
	app.use((error, req, res, next) => {
		if (res.headersSent) return next(error);
		if (error instanceof SyntaxError && error.status === 400 && "body" in error) return res.status(400).json({ error: "Request body must contain valid JSON." });
		if (error.type === "entity.too.large") return res.status(413).json({ error: "Request body is too large." });
		console.error(error);
		res.status(500).json({ error: "An unexpected server error occurred." });
	});

	app.use((req, res) => res.status(404).type("text/plain").send("Not found"));
	app.locals.db = database;
	return app;
}

if (require.main === module) {
	const dataDirectory = path.join(__dirname, ".data");
	fs.mkdirSync(dataDirectory, { recursive: true });
	const app = createApp();
	const port = Number(process.env.PORT) || 3000;
	const host = process.env.HOST || "127.0.0.1";
	app.listen(port, host, () => console.log(`Mulungushi accommodation system running at http://${host}:${port}`));
}

module.exports = { createApp, validateRequest };