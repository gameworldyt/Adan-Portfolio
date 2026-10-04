import { handlePortalFeature } from "./portal-features.js";

const SESSION_DAYS = 7;
const DEFAULT_SESSION_DAYS = 1;
const PASSWORD_ITERATIONS = 100000;
const RATE_LIMIT_WINDOW_SECONDS = 15 * 60;
const LOGIN_RATE_LIMIT = 8;
const WRITE_RATE_LIMIT = 120;

function securityHeaders(origin) {
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        "Vary": "Origin",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'"
    };
}

function json(data, status = 200, origin = "null", extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            ...securityHeaders(origin),
            ...extraHeaders
        }
    });
}

function getOrigin(request, env) {
    const requestOrigin = request.headers.get("Origin");
    const allowedOrigins = String(env.ALLOWED_ORIGIN || "")
        .split(",")
        .map(value => value.trim())
        .filter(Boolean);

    return requestOrigin && allowedOrigins.includes(requestOrigin)
        ? requestOrigin
        : "null";
}

function isAllowedOrigin(request, env) {
    const requestOrigin = request.headers.get("Origin");
    if (!requestOrigin) return true;

    return String(env.ALLOWED_ORIGIN || "")
        .split(",")
        .map(value => value.trim())
        .includes(requestOrigin);
}

function requestKey(request, prefix) {
    return `${prefix}:${request.headers.get("CF-Connecting-IP") || "unknown"}`;
}

async function consumeRateLimit(env, key, limit) {
    const now = Math.floor(Date.now() / 1000);
    const current = await env.DB
        .prepare("SELECT window_start, count FROM rate_limits WHERE key = ?")
        .bind(key)
        .first();

    if (!current || now - current.window_start >= RATE_LIMIT_WINDOW_SECONDS) {
        await env.DB
            .prepare(`
                INSERT INTO rate_limits (key, window_start, count)
                VALUES (?, ?, 1)
                ON CONFLICT(key) DO UPDATE SET
                    window_start = excluded.window_start,
                    count = 1
            `)
            .bind(key, now)
            .run();
        return { allowed: true, retryAfter: RATE_LIMIT_WINDOW_SECONDS };
    }

    if (current.count >= limit) {
        return {
            allowed: false,
            retryAfter: Math.max(1, RATE_LIMIT_WINDOW_SECONDS - (now - current.window_start))
        };
    }

    await env.DB
        .prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?")
        .bind(key)
        .run();

    return {
        allowed: true,
        retryAfter: Math.max(1, RATE_LIMIT_WINDOW_SECONDS - (now - current.window_start))
    };
}

function getCookie(request, name) {
    const cookie = request.headers.get("Cookie") || "";

    for (const part of cookie.split(";")) {
        const [key, ...value] = part.trim().split("=");

        if (key === name) {
            return value.join("=");
        }
    }

    return null;
}

function sessionCookie(id, maxAge) {
    return [
        `session=${id}`,
        "HttpOnly",
        "Secure",
        "SameSite=None",
        "Path=/",
        `Max-Age=${maxAge}`
    ].join("; ");
}

async function randomHex(bytes = 32) {
    const data = new Uint8Array(bytes);
    crypto.getRandomValues(data);

    return [...data]
        .map(x => x.toString(16).padStart(2, "0"))
        .join("");
}

function bufferToBase64(buffer) {
    return btoa(
        String.fromCharCode(...new Uint8Array(buffer))
    );
}

function base64ToBuffer(value) {
    return Uint8Array.from(
        atob(value),
        c => c.charCodeAt(0)
    );
}

async function hashPassword(password, salt = null) {
    const saltBytes = salt
        ? base64ToBuffer(salt)
        : crypto.getRandomValues(new Uint8Array(16));

    const encoder = new TextEncoder();

    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        "PBKDF2",
        false,
        ["deriveBits"]
    );

    const bits = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt: saltBytes,
            iterations: PASSWORD_ITERATIONS,
            hash: "SHA-256"
        },
        key,
        256
    );

    return {
        salt: bufferToBase64(saltBytes),
        hash: bufferToBase64(bits)
    };
}

async function verifyPassword(password, stored) {
    const [salt, expectedHash] = stored.split(":");

    if (!salt || !expectedHash) {
        return false;
    }

    const result = await hashPassword(
        password,
        salt
    );

    return result.hash === expectedHash;
}

async function makePasswordHash(password) {
    const result = await hashPassword(password);

    return `${result.salt}:${result.hash}`;
}

async function ensureOwner(env) {
    const email = env.OWNER_EMAIL?.trim().toLowerCase();
    const password = env.OWNER_PASSWORD;

    if (!email || !password) {
        throw new Error(
            "OWNER_EMAIL and OWNER_PASSWORD secrets are not configured."
        );
    }

    const existing = await env.DB
        .prepare(
            "SELECT id FROM accounts WHERE email = ? LIMIT 1"
        )
        .bind(email)
        .first();

    if (existing) {
        return;
    }

    const passwordHash = await makePasswordHash(password);

    await env.DB
        .prepare(`
            INSERT INTO accounts
            (email, password_hash, display_name, role, active)
            VALUES (?, ?, ?, 'owner', 1)
        `)
        .bind(
            email,
            passwordHash,
            "Adan"
        )
        .run();
}

async function getCurrentAccount(request, env) {
    const sessionId = getCookie(request, "session");

    if (!sessionId) {
        return null;
    }

    const session = await env.DB
        .prepare(`
            SELECT
                accounts.id,
                accounts.email,
                accounts.display_name,
                accounts.avatar_url,
                accounts.role,
                accounts.active
            FROM sessions
            JOIN accounts
                ON accounts.id = sessions.account_id
            WHERE sessions.id = ?
              AND sessions.expires_at > ?
              AND accounts.active = 1
            LIMIT 1
        `)
        .bind(
            sessionId,
            Math.floor(Date.now() / 1000)
        )
        .first();

    return session || null;
}

async function requireOwner(request, env) {
    const account = await getCurrentAccount(request, env);

    if (!account || account.role !== "owner") {
        return null;
    }

    return account;
}

async function login(request, env) {
    const body = await request.json();

    const email = String(body.email || "")
        .trim()
        .toLowerCase();

    const password = String(body.password || "");

    if (!email || !password) {
        return {
            error: "Email and password are required."
        };
    }

    const account = await env.DB
        .prepare(`
            SELECT *
            FROM accounts
            WHERE email = ?
              AND active = 1
            LIMIT 1
        `)
        .bind(email)
        .first();

    if (!account) {
        return {
            error: "Invalid email or password."
        };
    }

    const valid = await verifyPassword(
        password,
        account.password_hash
    );

    if (!valid) {
        return {
            error: "Invalid email or password."
        };
    }

    const sessionId = await randomHex(32);

    const remember = body.remember === true;
    const sessionDays = remember ? SESSION_DAYS : DEFAULT_SESSION_DAYS;
    const expiresAt =
        Math.floor(Date.now() / 1000) +
        sessionDays * 24 * 60 * 60;

    await env.DB
        .prepare(`
            INSERT INTO sessions
            (id, account_id, expires_at)
            VALUES (?, ?, ?)
        `)
        .bind(
            sessionId,
            account.id,
            expiresAt
        )
        .run();

    return {
        account: {
            id: account.id,
            email: account.email,
            display_name: account.display_name,
            role: account.role,
            remember
        },
        sessionId
    };
}

export default {
    async fetch(request, env) {
        const origin = getOrigin(request, env);

        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: {
                    "Access-Control-Allow-Origin": origin,
                    "Access-Control-Allow-Credentials": "true",
                    "Access-Control-Allow-Headers": "Content-Type",
                    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
                    "Vary": "Origin"
                }
            });
        }

        try {
            if (!isAllowedOrigin(request, env)) {
                return json({ error: "Origin is not allowed." }, 403, "null");
            }

            const url = new URL(request.url);
            const path = url.pathname;

            if (request.method !== "GET") {
                const limit = path === "/auth/login"
                    ? LOGIN_RATE_LIMIT
                    : WRITE_RATE_LIMIT;
                const rate = await consumeRateLimit(
                    env,
                    requestKey(request, path === "/auth/login" ? "login" : "write"),
                    limit
                );

                if (!rate.allowed) {
                    return json(
                        { error: "Too many requests. Please try again later." },
                        429,
                        origin,
                        { "Retry-After": String(rate.retryAfter) }
                    );
                }
            }

            await ensureOwner(env);

            if (
                request.method === "POST" &&
                path === "/auth/login"
            ) {
                const result = await login(request, env);

                if (result.error) {
                    return json(
                        result,
                        401,
                        origin
                    );
                }

                return new Response(
                    JSON.stringify({
                        account: result.account
                    }),
                    {
                        status: 200,
                        headers: {
                            ...securityHeaders(origin),
                            "Set-Cookie": sessionCookie(
                                result.sessionId,
                                result.account.remember
                                    ? SESSION_DAYS * 24 * 60 * 60
                                    : DEFAULT_SESSION_DAYS * 24 * 60 * 60
                            )
                        }
                    }
                );
            }

            if (
                request.method === "POST" &&
                path === "/auth/logout"
            ) {
                const sessionId =
                    getCookie(request, "session");

                if (sessionId) {
                    await env.DB
                        .prepare(
                            "DELETE FROM sessions WHERE id = ?"
                        )
                        .bind(sessionId)
                        .run();
                }

                return new Response(
                    JSON.stringify({
                        success: true
                    }),
                    {
                        headers: {
                            "Content-Type": "application/json",
                            "Set-Cookie": sessionCookie("", 0),
                            "Access-Control-Allow-Origin": origin,
                            "Access-Control-Allow-Credentials": "true"
                        }
                    }
                );
            }

            if (
                request.method === "GET" &&
                path === "/auth/me"
            ) {
                const account =
                    await getCurrentAccount(
                        request,
                        env
                    );

                return json(
                    {
                        authenticated: !!account,
                        account: account
                            ? {
                                id: account.id,
                                email: account.email,
                                display_name:
                                    account.display_name,
                                avatar_url:
                                    account.avatar_url || null,
                                role: account.role
                            }
                            : null
                    },
                    200,
                    origin
                );
            }

            if (
                request.method === "PATCH" &&
                path === "/auth/profile"
            ) {
                const customer =
                    await getCurrentAccount(request, env);

                if (!customer || customer.role !== "customer") {
                    return json(
                        { error: "Customer access required." },
                        403,
                        origin
                    );
                }

                const body = await request.json();
                const avatarUrl = String(body.avatar_url || "").trim();

                if (
                    avatarUrl &&
                    (
                        avatarUrl.length > 500 ||
                        !/^https:\/\/[^\s]+$/i.test(avatarUrl)
                    )
                ) {
                    return json(
                        {
                            error:
                                "Avatar must be a valid HTTPS image URL."
                        },
                        400,
                        origin
                    );
                }

                await env.DB.prepare(
                    "UPDATE accounts SET avatar_url = ? WHERE id = ?"
                )
                    .bind(avatarUrl || null, customer.id)
                    .run();

                return json(
                    {
                        success: true,
                        avatar_url: avatarUrl || null
                    },
                    200,
                    origin
                );
            }

            if (
                request.method === "GET" &&
                path === "/admin/accounts"
            ) {
                const owner =
                    await requireOwner(
                        request,
                        env
                    );

                if (!owner) {
                    return json(
                        { error: "Owner access required." },
                        403,
                        origin
                    );
                }

                const result = await env.DB
                    .prepare(`
                        SELECT
                            id,
                            email,
                            display_name,
                            role,
                            active,
                            created_at
                        FROM accounts
                        ORDER BY created_at DESC
                    `)
                    .all();

                return json(
                    { accounts: result.results },
                    200,
                    origin
                );
            }

            if (
                request.method === "POST" &&
                path === "/admin/accounts"
            ) {
                const owner =
                    await requireOwner(
                        request,
                        env
                    );

                if (!owner) {
                    return json(
                        { error: "Owner access required." },
                        403,
                        origin
                    );
                }

                const body =
                    await request.json();

                const email =
                    String(body.email || "")
                        .trim()
                        .toLowerCase();

                const password =
                    String(body.password || "");

                const displayName =
                    String(body.display_name || "")
                        .trim();

                if (
                    !email ||
                    !password ||
                    !displayName
                ) {
                    return json(
                        {
                            error:
                                "Display name, email and password are required."
                        },
                        400,
                        origin
                    );
                }

                if (password.length < 12) {
                    return json(
                        {
                            error:
                                "Customer passwords must be at least 12 characters."
                        },
                        400,
                        origin
                    );
                }

                const existing =
                    await env.DB
                        .prepare(
                            "SELECT id FROM accounts WHERE email = ?"
                        )
                        .bind(email)
                        .first();

                if (existing) {
                    return json(
                        {
                            error:
                                "An account with that email already exists."
                        },
                        409,
                        origin
                    );
                }

                const passwordHash =
                    await makePasswordHash(
                        password
                    );

                const result =
                    await env.DB
                        .prepare(`
                            INSERT INTO accounts
                            (email, password_hash, display_name, role, active)
                            VALUES (?, ?, ?, 'customer', 1)
                        `)
                        .bind(
                            email,
                            passwordHash,
                            displayName
                        )
                        .run();

                return json(
                    {
                        success: true,
                        id: result.meta.last_row_id
                    },
                    201,
                    origin
                );
            }

            if (
                request.method === "DELETE" &&
                path.startsWith("/admin/accounts/")
            ) {
                const owner =
                    await requireOwner(
                        request,
                        env
                    );

                if (!owner) {
                    return json(
                        { error: "Owner access required." },
                        403,
                        origin
                    );
                }

                const id =
                    Number(
                        path.split("/").pop()
                    );

                if (!Number.isInteger(id)) {
                    return json(
                        { error: "Invalid account ID." },
                        400,
                        origin
                    );
                }

                if (id === owner.id) {
                    return json(
                        {
                            error:
                                "The owner account cannot be deleted."
                        },
                        400,
                        origin
                    );
                }

                await env.DB
                    .prepare(
                        "DELETE FROM sessions WHERE account_id = ?"
                    )
                    .bind(id)
                    .run();

                const deletion =
                    await env.DB
                    .prepare(
                        "DELETE FROM accounts WHERE id = ? AND role = 'customer'"
                    )
                    .bind(id)
                    .run();

                if (!deletion.meta.changes) {
                    return json(
                        { error: "Customer account not found." },
                        404,
                        origin
                    );
                }

                return json(
                    { success: true },
                    200,
                    origin
                );
            }

            if (
                request.method === "GET" &&
                path === "/admin/reviews"
            ) {
                const owner =
                    await requireOwner(
                        request,
                        env
                    );

                if (!owner) {
                    return json(
                        { error: "Owner access required." },
                        403,
                        origin
                    );
                }

                const result =
                    await env.DB
                        .prepare(`
                            SELECT
                                reviews.id,
                                reviews.rating,
                                reviews.review_text,
                                reviews.approved,
                                reviews.created_at,
                                accounts.display_name,
                                accounts.email
                            FROM reviews
                            JOIN accounts
                                ON accounts.id = reviews.account_id
                            ORDER BY reviews.created_at DESC
                        `)
                        .all();

                return json(
                    { reviews: result.results },
                    200,
                    origin
                );
            }

            if (
                request.method === "POST" &&
                path.match(/^\/admin\/reviews\/\d+\/approve$/)
            ) {
                const owner =
                    await requireOwner(
                        request,
                        env
                    );

                if (!owner) {
                    return json(
                        { error: "Owner access required." },
                        403,
                        origin
                    );
                }

                const id =
                    Number(
                        path.split("/")[3]
                    );

                await env.DB
                    .prepare(
                        "UPDATE reviews SET approved = 1 WHERE id = ?"
                    )
                    .bind(id)
                    .run();

                return json(
                    { success: true },
                    200,
                    origin
                );
            }

            if (
                request.method === "DELETE" &&
                path.match(/^\/admin\/reviews\/\d+$/)
            ) {
                const owner =
                    await requireOwner(
                        request,
                        env
                    );

                if (!owner) {
                    return json(
                        { error: "Owner access required." },
                        403,
                        origin
                    );
                }

                const id =
                    Number(
                        path.split("/").pop()
                    );

                await env.DB
                    .prepare(
                        "DELETE FROM reviews WHERE id = ?"
                    )
                    .bind(id)
                    .run();

                return json(
                    { success: true },
                    200,
                    origin
                );
            }

            if (
                request.method === "POST" &&
                path === "/reviews"
            ) {
                const account =
                    await getCurrentAccount(
                        request,
                        env
                    );

                if (!account) {
                    return json(
                        {
                            error:
                                "You must be signed in."
                        },
                        401,
                        origin
                    );
                }

                const body =
                    await request.json();

                const rating =
                    Number(body.rating);

                const reviewText =
                    String(body.review_text || "")
                        .trim();

                if (
                    !Number.isInteger(rating) ||
                    rating < 1 ||
                    rating > 5 ||
                    !reviewText
                ) {
                    return json(
                        {
                            error:
                                "A rating from 1-5 and review text are required."
                        },
                        400,
                        origin
                    );
                }

                await env.DB
                    .prepare(`
                        INSERT INTO reviews
                        (account_id, rating, review_text)
                        VALUES (?, ?, ?)
                    `)
                    .bind(
                        account.id,
                        rating,
                        reviewText
                    )
                    .run();

                return json(
                    {
                        success: true,
                        message:
                            "Review submitted for approval."
                    },
                    201,
                    origin
                );
            }

            if (
                request.method === "GET" &&
                path === "/reviews"
            ) {
                const result = await env.DB
                    .prepare(`
                        SELECT
                            reviews.id,
                            reviews.rating,
                            reviews.review_text,
                            reviews.created_at,
                            accounts.display_name,
                            accounts.email
                        FROM reviews
                        JOIN accounts
                            ON accounts.id = reviews.account_id
                        WHERE reviews.approved = 1
                        ORDER BY reviews.created_at DESC
                    `)
                    .all();

                return json(
                    { reviews: result.results || [] },
                    200,
                    origin
                );
            }

            if (
                request.method === "GET" &&
                path === "/images"
            ) {
                const result = await env.DB
                    .prepare(`
                        SELECT id, name, url, category, project_id,
                            experience_id, created_at
                        FROM images
                        ORDER BY id DESC
                    `)
                    .all();

                return json(
                    { images: result.results || [] },
                    200,
                    origin
                );
            }

            /*
             * ADMIN PROJECT CRUD
             */

            if (
                request.method === "POST" &&
                path === "/admin/projects"
            ) {
                const owner =
                    await requireOwner(request, env);

                if (!owner) {
                    return json(
                        { error: "Owner access required." },
                        403,
                        origin
                    );
                }

                const body = await request.json();

                const title =
                    String(body.title || "").trim();

                const description =
                    String(body.description || "").trim();

                const category =
                    String(body.category || "").trim();

                const featured =
                    body.featured ? 1 : 0;

                const sortOrder =
                    Number.isFinite(Number(body.sort_order))
                        ? Number(body.sort_order)
                        : 0;

                if (!title || !description || !category) {
                    return json(
                        {
                            error:
                                "Title, description and category are required."
                        },
                        400,
                        origin
                    );
                }

                const result =
                    await env.DB
                        .prepare(`
                            INSERT INTO projects
                            (
                                title,
                                description,
                                category,
                                featured,
                                sort_order
                            )
                            VALUES (?, ?, ?, ?, ?)
                        `)
                        .bind(
                            title,
                            description,
                            category,
                            featured,
                            sortOrder
                        )
                        .run();

                return json(
                    {
                        success: true,
                        id: result.meta.last_row_id
                    },
                    201,
                    origin
                );
            }


            if (
                request.method === "PUT" &&
                path.match(/^\/admin\/projects\/\d+$/)
            ) {
                const owner =
                    await requireOwner(request, env);

                if (!owner) {
                    return json(
                        { error: "Owner access required." },
                        403,
                        origin
                    );
                }

                const id =
                    Number(path.split("/").pop());

                const body = await request.json();

                const title =
                    String(body.title || "").trim();

                const description =
                    String(body.description || "").trim();

                const category =
                    String(body.category || "").trim();

                const featured =
                    body.featured ? 1 : 0;

                const sortOrder =
                    Number.isFinite(Number(body.sort_order))
                        ? Number(body.sort_order)
                        : 0;

                if (!title || !description || !category) {
                    return json(
                        {
                            error:
                                "Title, description and category are required."
                        },
                        400,
                        origin
                    );
                }

                const result =
                    await env.DB
                        .prepare(`
                            UPDATE projects
                            SET
                                title = ?,
                                description = ?,
                                category = ?,
                                featured = ?,
                                sort_order = ?
                            WHERE id = ?
                        `)
                        .bind(
                            title,
                            description,
                            category,
                            featured,
                            sortOrder,
                            id
                        )
                        .run();

                if (!result.meta.changes) {
                    return json(
                        { error: "Project not found." },
                        404,
                        origin
                    );
                }

                return json(
                    { success: true },
                    200,
                    origin
                );
            }


            if (
                request.method === "DELETE" &&
                path.match(/^\/admin\/projects\/\d+$/)
            ) {
                const owner =
                    await requireOwner(request, env);

                if (!owner) {
                    return json(
                        { error: "Owner access required." },
                        403,
                        origin
                    );
                }

                const id =
                    Number(path.split("/").pop());

                const result =
                    await env.DB
                        .prepare(
                            "DELETE FROM projects WHERE id = ?"
                        )
                        .bind(id)
                        .run();

                if (!result.meta.changes) {
                    return json(
                        { error: "Project not found." },
                        404,
                        origin
                    );
                }

                return json(
                    { success: true },
                    200,
                    origin
                );
            }


            /*
             * ADMIN EXPERIENCE CRUD
             */

            if (
                request.method === "POST" &&
                path === "/admin/experience"
            ) {
                const owner =
                    await requireOwner(request, env);

                if (!owner) {
                    return json(
                        { error: "Owner access required." },
                        403,
                        origin
                    );
                }

                const body = await request.json();

                const organization =
                    String(body.organization || "").trim();

                const role =
                    String(body.role || "").trim();

                const category =
                    String(body.category || "").trim();

                const sortOrder =
                    Number.isFinite(Number(body.sort_order))
                        ? Number(body.sort_order)
                        : 0;

                const allowedCategories = [
                    "senior",
                    "high",
                    "middle",
                    "entry"
                ];

                if (
                    !organization ||
                    !role ||
                    !allowedCategories.includes(category)
                ) {
                    return json(
                        {
                            error:
                                "Organization, role and a valid category are required."
                        },
                        400,
                        origin
                    );
                }

                const result =
                    await env.DB
                        .prepare(`
                            INSERT INTO experience
                            (
                                organization,
                                role,
                                category,
                                sort_order
                            )
                            VALUES (?, ?, ?, ?)
                        `)
                        .bind(
                            organization,
                            role,
                            category,
                            sortOrder
                        )
                        .run();

                return json(
                    {
                        success: true,
                        id: result.meta.last_row_id
                    },
                    201,
                    origin
                );
            }


            if (
                request.method === "PUT" &&
                path.match(/^\/admin\/experience\/\d+$/)
            ) {
                const owner =
                    await requireOwner(request, env);

                if (!owner) {
                    return json(
                        { error: "Owner access required." },
                        403,
                        origin
                    );
                }

                const id =
                    Number(path.split("/").pop());

                const body = await request.json();

                const organization =
                    String(body.organization || "").trim();

                const role =
                    String(body.role || "").trim();

                const category =
                    String(body.category || "").trim();

                const sortOrder =
                    Number.isFinite(Number(body.sort_order))
                        ? Number(body.sort_order)
                        : 0;

                const allowedCategories = [
                    "senior",
                    "high",
                    "middle",
                    "entry"
                ];

                if (
                    !organization ||
                    !role ||
                    !allowedCategories.includes(category)
                ) {
                    return json(
                        {
                            error:
                                "Organization, role and a valid category are required."
                        },
                        400,
                        origin
                    );
                }

                const result =
                    await env.DB
                        .prepare(`
                            UPDATE experience
                            SET
                                organization = ?,
                                role = ?,
                                category = ?,
                                sort_order = ?
                            WHERE id = ?
                        `)
                        .bind(
                            organization,
                            role,
                            category,
                            sortOrder,
                            id
                        )
                        .run();

                if (!result.meta.changes) {
                    return json(
                        { error: "Experience entry not found." },
                        404,
                        origin
                    );
                }

                return json(
                    { success: true },
                    200,
                    origin
                );
            }


            if (
                request.method === "DELETE" &&
                path.match(/^\/admin\/experience\/\d+$/)
            ) {
                const owner =
                    await requireOwner(request, env);

                if (!owner) {
                    return json(
                        { error: "Owner access required." },
                        403,
                        origin
                    );
                }

                const id =
                    Number(path.split("/").pop());

                const result =
                    await env.DB
                        .prepare(
                            "DELETE FROM experience WHERE id = ?"
                        )
                        .bind(id)
                        .run();

                if (!result.meta.changes) {
                    return json(
                        {
                            error:
                                "Experience entry not found."
                        },
                        404,
                        origin
                    );
                }

                return json(
                    { success: true },
                    200,
                    origin
                );
            }
            /*
             * PORTAL FEATURES
             */

            const portalResult =
                await handlePortalFeature(
                    request,
                    env,
                    path,
                    await getCurrentAccount(request, env),
                    origin
                );

            if (portalResult) {
                return portalResult;
            }
            if (
                request.method === "GET" &&
                path === "/projects"
            ) {
                const result =
                    await env.DB
                        .prepare(`
                            SELECT *
                            FROM projects
                            ORDER BY sort_order ASC, id ASC
                        `)
                        .all();

                return json(
                    { projects: result.results },
                    200,
                    origin
                );
            }

            if (
                request.method === "GET" &&
                path === "/experience"
            ) {
                const result =
                    await env.DB
                        .prepare(`
                            SELECT *
                            FROM experience
                            ORDER BY sort_order ASC, id ASC
                        `)
                        .all();

                return json(
                    { experience: result.results },
                    200,
                    origin
                );
            }

            return json(
                {
                    error: "Not found."
                },
                404,
                origin
            );

        } catch (error) {
            console.error(error);

            return json(
                {
                    error:
                        "Internal server error."
                },
                500,
                origin
            );
        }
    }
};
