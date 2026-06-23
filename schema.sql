CREATE TABLE IF NOT EXISTS fuel_records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT    NOT NULL,
    odometer    REAL    NOT NULL,
    liters      REAL    NOT NULL,
    price_total REAL    NOT NULL,
    fuel_type   TEXT    NOT NULL DEFAULT '95',
    note        TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mileage_records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT    NOT NULL,
    odometer    REAL    NOT NULL,
    note        TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fuel_date     ON fuel_records(date);
CREATE INDEX IF NOT EXISTS idx_fuel_odometer ON fuel_records(odometer);
