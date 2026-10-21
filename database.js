const Database = require("better-sqlite3");
const crypto = require("node:crypto");

const seedListings = [
	{
		id: "willow-house",
		title: "Kabwe Central Room",
		area: "Kabwe Central",
		campus: "Mulungushi University",
		type: "private",
		typeLabel: "Private room",
		price: 1800,
		details: ["Private room", "Shared kitchen", "Water storage"],
		commute: "Confirm route to campus",
		availability: "Demo listing",
		tag: "Case study sample",
		image: "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=960&q=85",
		alt: "Light-filled apartment living room with a sofa and large windows"
	},
	{
		id: "cedar-studio",
		title: "Chowa Self-Contained Unit",
		area: "Chowa, Kabwe",
		campus: "Mulungushi University",
		type: "studio",
		typeLabel: "Studio",
		price: 3200,
		details: ["Self-contained", "Private bathroom", "Prepaid power"],
		commute: "Confirm route to campus",
		availability: "Demo listing",
		tag: "Case study sample",
		image: "https://images.unsplash.com/photo-1493809842364-78817add7ffb?auto=format&fit=crop&w=960&q=85",
		alt: "Warm, compact studio apartment with a dining table and sitting area"
	},
	{
		id: "elm-flat",
		title: "Makululu Shared House",
		area: "Makululu, Kabwe",
		campus: "Mulungushi University",
		type: "shared",
		typeLabel: "Shared room",
		price: 1500,
		details: ["Shared room", "Shared cooking area", "Water storage"],
		commute: "Confirm route to campus",
		availability: "Demo listing",
		tag: "Case study sample",
		image: "https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?auto=format&fit=crop&w=960&q=85",
		alt: "Calm bedroom with a neatly made bed and warm wood furniture"
	},
	{
		id: "park-view",
		title: "Highridge One-Bedroom",
		area: "Highridge, Kabwe",
		campus: "Mulungushi University",
		type: "apartment",
		typeLabel: "Entire apartment",
		price: 4500,
		details: ["1 bedroom", "Private kitchen", "Electricity prepaid"],
		commute: "Confirm route to campus",
		availability: "Demo listing",
		tag: "Case study sample",
		image: "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=960&q=85",
		alt: "Bright apartment interior with a dining table beside a large window"
	},
	{
		id: "birch-room",
		title: "Railway Area Private Room",
		area: "Railway area, Kabwe",
		campus: "Mulungushi University",
		type: "private",
		typeLabel: "Private room",
		price: 2200,
		details: ["Private room", "Shared bathroom", "Secure yard"],
		commute: "Confirm route to campus",
		availability: "Demo listing",
		tag: "Case study sample",
		image: "https://images.unsplash.com/photo-1518780664697-55e3ad937233?auto=format&fit=crop&w=960&q=85",
		alt: "Welcoming home surrounded by leafy trees"
	},
	{
		id: "market-loft",
		title: "Great North Road Studio",
		area: "Great North Road area, PPC",
		campus: "Mulungushi University",
		type: "studio",
		typeLabel: "Studio",
		price: 3500,
		details: ["Studio room", "Private bathroom", "Prepaid power"],
		commute: "Confirm route to campus",
		availability: "Demo listing",
		tag: "Case study sample",
		image: "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=960&q=85",
		alt: "Modern home exterior with a welcoming front entrance"
	}
];

function createDatabase(databasePath) {
	const db = new Database(databasePath);
	db.pragma("journal_mode = WAL");
	db.pragma("foreign_keys = ON");

	db.exec(`
		CREATE TABLE IF NOT EXISTS listings (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			area TEXT NOT NULL,
			campus TEXT NOT NULL,
			type TEXT NOT NULL CHECK (type IN ('private', 'shared', 'studio', 'apartment')),
			type_label TEXT NOT NULL,
			price_zmw INTEGER NOT NULL CHECK (price_zmw > 0),
			details_json TEXT NOT NULL,
			commute TEXT NOT NULL,
			availability TEXT NOT NULL,
			tag TEXT NOT NULL,
			image TEXT NOT NULL,
			alt TEXT NOT NULL,
			display_order INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS accommodation_requests (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			email TEXT NOT NULL,
			phone TEXT NOT NULL,
			campus TEXT NOT NULL,
			room_type TEXT NOT NULL,
			budget_zmw INTEGER NOT NULL CHECK (budget_zmw > 0),
			move_in TEXT NOT NULL,
			facilities_json TEXT NOT NULL,
			message TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS saved_listings (
			client_id TEXT NOT NULL,
			listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (client_id, listing_id)
		);

		CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			email TEXT NOT NULL UNIQUE COLLATE NOCASE,
			student_id TEXT,
			phone TEXT NOT NULL,
			role TEXT NOT NULL CHECK (role IN ('student', 'landlord', 'admin')),
			verified INTEGER NOT NULL DEFAULT 1 CHECK (verified IN (0, 1)),
			password_salt TEXT NOT NULL,
			password_hash TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS sessions (
			token_hash TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			expires_at TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS bookings (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
			message TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (student_id, listing_id)
		);

		CREATE TABLE IF NOT EXISTS activity_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
			action TEXT NOT NULL,
			details TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS landlord_full_requests (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
			landlord_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'declined')),
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			resolved_at TEXT,
			resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL
		);

		CREATE TABLE IF NOT EXISTS landlord_removal_requests (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
			landlord_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			reason TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			resolved_at TEXT,
			resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL
		);

		CREATE TABLE IF NOT EXISTS rent_payments (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
			rent_month TEXT NOT NULL,
			paid_on TEXT NOT NULL,
			amount_zmw INTEGER NOT NULL CHECK (amount_zmw > 0),
			recorded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (booking_id, rent_month)
		);
	`);

	const addColumnIfMissing = (table, column, definition) => {
		const columns = db.prepare(`PRAGMA table_info(${table})`).all();
		if (!columns.some((item) => item.name === column)) {
			db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
		}
	};
	addColumnIfMissing("listings", "created_by", "TEXT REFERENCES users(id) ON DELETE SET NULL");
	addColumnIfMissing("listings", "status", "TEXT NOT NULL DEFAULT 'approved'");
	addColumnIfMissing("listings", "created_at", "TEXT");
	addColumnIfMissing("listings", "total_spaces", "INTEGER NOT NULL DEFAULT 1 CHECK (total_spaces > 0)");
	addColumnIfMissing("listings", "available_spaces", "INTEGER NOT NULL DEFAULT 1 CHECK (available_spaces >= 0)");
	addColumnIfMissing("listings", "occupancy_status", "TEXT NOT NULL DEFAULT 'available' CHECK (occupancy_status IN ('available', 'pending_review', 'full'))");
	addColumnIfMissing("users", "deleted_at", "TEXT");
	addColumnIfMissing("users", "student_id", "TEXT");
	addColumnIfMissing("bookings", "tenancy_status", "TEXT NOT NULL DEFAULT 'pending' CHECK (tenancy_status IN ('pending', 'accommodating', 'removed'))");
	addColumnIfMissing("bookings", "accepted_at", "TEXT");
	addColumnIfMissing("bookings", "rent_due_day", "INTEGER CHECK (rent_due_day BETWEEN 1 AND 28)");
	db.prepare("UPDATE listings SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL").run();
	db.prepare("UPDATE bookings SET tenancy_status = 'accommodating', accepted_at = COALESCE(accepted_at, created_at) WHERE status = 'accepted' AND tenancy_status = 'pending'").run();
	db.prepare("UPDATE bookings SET tenancy_status = 'pending' WHERE status != 'accepted' AND tenancy_status = 'pending'").run();
	db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_student_id_unique ON users (student_id COLLATE NOCASE) WHERE student_id IS NOT NULL");

	const insertListing = db.prepare(`
		INSERT OR IGNORE INTO listings (
			id, title, area, campus, type, type_label, price_zmw, details_json,
			commute, availability, tag, image, alt
		) VALUES (
			@id, @title, @area, @campus, @type, @typeLabel, @price, @details,
			@commute, @availability, @tag, @image, @alt
		)
	`);
	const seed = db.transaction((records) => {
		for (const listing of records) {
			insertListing.run({ ...listing, details: JSON.stringify(listing.details) });
		}
	});
	seed(seedListings);
	const columns = db.prepare("PRAGMA table_info(listings)").all();
	if (!columns.some((column) => column.name === "display_order")) {
		db.exec("ALTER TABLE listings ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0");
	}
	const setDisplayOrder = db.prepare("UPDATE listings SET display_order = ? WHERE id = ?");
	seedListings.forEach((listing, index) => setDisplayOrder.run(index, listing.id));

	const adminExists = db.prepare("SELECT id FROM users WHERE email = ?").get("admin@mulungushi.local");
	if (!adminExists) {
		const salt = crypto.randomBytes(16).toString("hex");
		const passwordHash = crypto.scryptSync("admin123", salt, 64).toString("hex");
		db.prepare(`
			INSERT INTO users (id, name, email, phone, role, verified, password_salt, password_hash)
			VALUES (?, ?, ?, ?, 'admin', 1, ?, ?)
		`).run(crypto.randomUUID(), "System Administrator", "admin@mulungushi.local", "", salt, passwordHash);
	}

	return db;
}

module.exports = { createDatabase };