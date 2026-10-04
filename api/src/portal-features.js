function json(data, status = 200, origin = "*") {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS"
        }
    });
}

function cors(origin) {
    return new Response(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS"
        }
    });
}

function randomToken() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);

    return Array.from(bytes)
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");
}

async function readJson(request) {
    try {
        return await request.json();
    } catch {
        throw new Error("Invalid JSON request.");
    }
}

function requireOwner(account, origin) {
    if (!account || account.role !== "owner") {
        return json(
            { error: "Owner access required." },
            403,
            origin
        );
    }

    return null;
}

function requireCustomer(account, origin) {
    if (
        !account ||
        (account.role !== "customer" && account.role !== "owner")
    ) {
        return json(
            { error: "Customer sign-in required." },
            401,
            origin
        );
    }

    return null;
}

async function notifyDiscord(env, message) {
    if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_OWNER_ID) {
        return {
            success: false,
            reason: "Discord notification is not configured."
        };
    }

    try {
        // Create/open a DM channel with the owner.
        const channelResponse = await fetch(
            "https://discord.com/api/v10/users/@me/channels",
            {
                method: "POST",
                headers: {
                    "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`,
                    "Content-Type": "application/json",
                    "User-Agent": "AdanPortfolio/1.0"
                },
                body: JSON.stringify({
                    recipient_id: env.DISCORD_OWNER_ID
                })
            }
        );

        if (!channelResponse.ok) {
            const errorText = await channelResponse.text();

            console.error(
                "Discord DM channel creation failed:",
                channelResponse.status,
                errorText.slice(0, 500)
            );

            return {
                success: false,
                reason: `Discord channel creation failed: ${channelResponse.status}`
            };
        }

        const channel = await channelResponse.json();

        // Send the notification into the DM.
        const messageResponse = await fetch(
            `https://discord.com/api/v10/channels/${channel.id}/messages`,
            {
                method: "POST",
                headers: {
                    "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`,
                    "Content-Type": "application/json",
                    "User-Agent": "AdanPortfolio/1.0"
                },
                body: JSON.stringify({
                    content: message.slice(0, 2000)
                })
            }
        );

        if (!messageResponse.ok) {
            const errorText = await messageResponse.text();

            console.error(
                "Discord DM message failed:",
                messageResponse.status,
                errorText.slice(0, 500)
            );

            return {
                success: false,
                reason: `Discord message failed: ${messageResponse.status}`
            };
        }

        const discordMessage = await messageResponse.json();

        return {
            success: true,
            channel_id: channel.id,
            message_id: discordMessage.id
        };
    } catch (error) {
        console.error("Discord notification error:", error);

        return {
            success: false,
            reason: error.message
        };
    }
}
async function notifyEmail(env, message, subject = "New Adan Portfolio Message") {
    console.log(
        "Email notification starting. API key configured:",
        Boolean(env.RESEND_API_KEY),
        "Owner email configured:",
        Boolean(env.OWNER_EMAIL)
    );

    if (!env.RESEND_API_KEY || !env.OWNER_EMAIL) {
        console.error(
            "Email notification is not configured."
        );

        return {
            success: false,
            reason: "Email notification is not configured."
        };
    }

    try {
        const htmlMessage = String(message)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\n/g, "<br>");

        const response = await fetch(
            "https://api.resend.com/emails",
            {
                method: "POST",
                headers: {
                    "Authorization": "Bearer " + env.RESEND_API_KEY,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    from: "Adan Portfolio <onboarding@resend.dev>",
                    to: [env.OWNER_EMAIL],
                    subject,
                    html: `
                        <div style="font-family:Arial,sans-serif;max-width:700px;margin:auto">
                            <h2>?? New Portfolio Message</h2>
                            <div style="padding:16px;background:#f4f7fb;border-radius:10px">
                                ${htmlMessage}
                            </div>
                            <p style="color:#666;font-size:13px">
                                This notification was sent by your Adan Portfolio Worker.
                            </p>
                        </div>
                    `
                })
            }
        );

        const responseText = await response.text();

        console.log(
            "Resend response:",
            response.status,
            responseText.slice(0, 1000)
        );

        if (!response.ok) {
            console.error(
                "Resend email failed:",
                response.status,
                responseText.slice(0, 1000)
            );

            return {
                success: false,
                reason: `Resend failed: ${response.status}`
            };
        }

        let result;

        try {
            result = JSON.parse(responseText);
        } catch {
            result = {};
        }

        console.log(
            "Resend email accepted successfully:",
            result.id || "no-id"
        );

        return {
            success: true,
            email_id: result.id || null
        };
    } catch (error) {
        console.error(
            "Email notification error:",
            error
        );

        return {
            success: false,
            reason: error.message
        };
    }
}
async function notifyOwner(env, message, subject = "New Adan Portfolio Message") {
    const discordResult = await notifyDiscord(
        env,
        message
    );

    const emailResult = await notifyEmail(
        env,
        message,
        subject
    );

    return {
        discord: discordResult,
        email: emailResult
    };
}
async function uploadImageToGitHub(env, file) {
    if (
        !env.GITHUB_TOKEN ||
        !env.GITHUB_REPO ||
        !env.GITHUB_BRANCH
    ) {
        throw new Error(
            "GitHub image storage is not configured."
        );
    }

    const safeName = String(file.name || "image")
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, "-")
        .replace(/-+/g, "-");

    const filename =
        `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;

    const path = `assets/uploads/${filename}`;

    const response = await fetch(
        `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`,
        {
            method: "PUT",
            headers: {
                "Authorization": "Bearer " + env.GITHUB_TOKEN,
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "adan-portfolio-worker",
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                message: `Upload portfolio image: ${filename}`,
                content: file.data_base64,
                branch: env.GITHUB_BRANCH
            })
        }
    );

    if (!response.ok) {
        const errorText = await response.text();

        throw new Error(
            `GitHub upload failed (${response.status}): ${errorText.slice(0, 300)}`
        );
    }

    return {
        filename,
        path,
        url:
            `https://raw.githubusercontent.com/${env.GITHUB_REPO}/${env.GITHUB_BRANCH}/${path}`
    };
}

async function getConversation(env, id) {
    return await env.DB.prepare(`
        SELECT
            c.*,
            a.display_name AS account_name,
            a.email AS account_email
        FROM conversations c
        LEFT JOIN accounts a
            ON a.id = c.account_id
        WHERE c.id = ?
    `)
        .bind(id)
        .first();
}

async function getMessages(env, conversationId) {
    const result = await env.DB.prepare(`
        SELECT
            m.id,
            m.conversation_id,
            m.sender_account_id,
            m.message_text,
            m.created_at,
            a.display_name AS sender_name,
            CASE
                WHEN a.role = 'owner' THEN 'owner'
                WHEN a.role = 'customer' THEN 'customer'
                ELSE 'guest'
            END AS sender_type
        FROM messages m
        LEFT JOIN accounts a
            ON a.id = m.sender_account_id
        WHERE m.conversation_id = ?
        ORDER BY m.id ASC
    `)
        .bind(conversationId)
        .all();

    return result.results || [];
}

export async function handlePortalFeature(
    request,
    env,
    path,
    account,
    origin
) {
    if (request.method === "OPTIONS") {
        return cors(origin);
    }

    try {
        /*
         * ============================================================
         * PUBLIC REVIEWS
         * ============================================================
         */

        if (
            request.method === "GET" &&
            path === "/reviews"
        ) {
            const result = await env.DB.prepare(`
                SELECT
                    r.id,
                    r.rating,
                    r.review_text,
                    r.created_at,
                    a.display_name,
                    a.avatar_url
                FROM reviews r
                INNER JOIN accounts a
                    ON a.id = r.account_id
                WHERE r.approved = 1
                  AND a.active = 1
                ORDER BY r.created_at DESC
            `).all();

            return json(
                {
                    reviews: result.results || []
                },
                200,
                origin
            );
        }

        if (
            request.method === "GET" &&
            path === "/images"
        ) {
            const result = await env.DB.prepare(`
                SELECT id, name, url, category, project_id,
                    experience_id, created_at
                FROM images
                ORDER BY id DESC
            `).all();

            return json(
                { images: result.results || [] },
                200,
                origin
            );
        }

        /*
         * ============================================================
         * CUSTOMER REVIEWS
         * ============================================================
         */

        if (
            request.method === "POST" &&
            path === "/reviews"
        ) {
            const authError = requireCustomer(account, origin);

            if (authError) {
                return authError;
            }

            if (account.role !== "customer") {
                return json(
                    {
                        error:
                            "Only customer accounts can submit reviews."
                    },
                    403,
                    origin
                );
            }

            const body = await readJson(request);

            const rating = Number(body.rating);
            const reviewText = String(
                body.review_text || ""
            ).trim();

            if (
                !Number.isInteger(rating) ||
                rating < 1 ||
                rating > 5
            ) {
                return json(
                    {
                        error:
                            "Rating must be between 1 and 5."
                    },
                    400,
                    origin
                );
            }

            if (!reviewText) {
                return json(
                    {
                        error:
                            "Review text is required."
                    },
                    400,
                    origin
                );
            }

            if (reviewText.length > 2000) {
                return json(
                    {
                        error:
                            "Review is too long."
                    },
                    400,
                    origin
                );
            }

            const result = await env.DB.prepare(`
                INSERT INTO reviews
                (
                    account_id,
                    rating,
                    review_text,
                    approved
                )
                VALUES (?, ?, ?, 0)
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
                    id: result.meta.last_row_id,
                    message:
                        "Review submitted for approval."
                },
                201,
                origin
            );
        }

        if (
            request.method === "GET" &&
            path === "/jobs"
        ) {
            const authError = requireCustomer(account, origin);
            if (authError) return authError;

            const result = await env.DB.prepare(`
                SELECT id, title, description, status, payment_method,
                    payment_status, created_at, updated_at
                FROM jobs
                WHERE account_id = ?
                ORDER BY id DESC
            `).bind(account.id).all();

            return json({ jobs: result.results || [] }, 200, origin);
        }

        if (
            request.method === "POST" &&
            path === "/jobs"
        ) {
            const authError = requireCustomer(account, origin);
            if (authError) return authError;

            const body = await readJson(request);
            const title = String(body.title || "").trim();
            const description = String(body.description || "").trim();
            const paymentMethod = String(body.payment_method || "").trim();

            if (!title || !description) {
                return json(
                    { error: "Job title and description are required." },
                    400,
                    origin
                );
            }

            if (!["robux", "paypal"].includes(paymentMethod)) {
                return json(
                    { error: "Choose Robux or PayPal as the payment method." },
                    400,
                    origin
                );
            }

            const result = await env.DB.prepare(`
                INSERT INTO jobs
                (account_id, title, description, payment_method)
                VALUES (?, ?, ?, ?)
            `).bind(
                account.id,
                title.slice(0, 120),
                description.slice(0, 4000),
                paymentMethod
            ).run();

            await notifyOwner(
                env,
                `🛠️ New job request\n\nCustomer: ${account.display_name}\nEmail: ${account.email}\nTitle: ${title}\nPayment: ${paymentMethod}\n\n${description}`,
                "New Adan Portfolio Job Request"
            );

            return json(
                { success: true, job_id: result.meta.last_row_id },
                201,
                origin
            );
        }

        /*
         * ============================================================
         * OWNER: WRITE REVIEW FOR CUSTOMER
         * ============================================================
         */

        if (
            request.method === "POST" &&
            path === "/admin/reviews"
        ) {
            const authError = requireOwner(account, origin);

            if (authError) {
                return authError;
            }

            const body = await readJson(request);

            const accountId = Number(body.account_id);
            const rating = Number(body.rating);
            const reviewText = String(
                body.review_text || ""
            ).trim();

            if (!Number.isInteger(accountId)) {
                return json(
                    {
                        error:
                            "Customer account is required."
                    },
                    400,
                    origin
                );
            }

            if (
                !Number.isInteger(rating) ||
                rating < 1 ||
                rating > 5
            ) {
                return json(
                    {
                        error:
                            "Rating must be between 1 and 5."
                    },
                    400,
                    origin
                );
            }

            if (!reviewText) {
                return json(
                    {
                        error:
                            "Review text is required."
                    },
                    400,
                    origin
                );
            }

            const customer =
                await env.DB.prepare(`
                    SELECT id
                    FROM accounts
                    WHERE id = ?
                      AND role = 'customer'
                      AND active = 1
                `)
                    .bind(accountId)
                    .first();

            if (!customer) {
                return json(
                    {
                        error:
                            "Customer account not found."
                    },
                    404,
                    origin
                );
            }

            const result = await env.DB.prepare(`
                INSERT INTO reviews
                (
                    account_id,
                    rating,
                    review_text,
                    approved
                )
                VALUES (?, ?, ?, 1)
            `)
                .bind(
                    accountId,
                    rating,
                    reviewText
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

        /*
         * ============================================================
         * OWNER: ACCOUNT STATUS
         * ============================================================
         */

        const accountStatusMatch =
            path.match(
                /^\/admin\/accounts\/(\d+)\/status$/
            );

        if (
            request.method === "POST" &&
            accountStatusMatch
        ) {
            const authError = requireOwner(account, origin);

            if (authError) {
                return authError;
            }

            const id = Number(
                accountStatusMatch[1]
            );

            if (id === account.id) {
                return json(
                    {
                        error:
                            "You cannot terminate your own owner account."
                    },
                    400,
                    origin
                );
            }

            const body = await readJson(request);

            const active = body.active ? 1 : 0;

            const target =
                await env.DB.prepare(`
                    SELECT id, role
                    FROM accounts
                    WHERE id = ?
                `)
                    .bind(id)
                    .first();

            if (!target) {
                return json(
                    {
                        error:
                            "Account not found."
                    },
                    404,
                    origin
                );
            }

            if (target.role === "owner") {
                return json(
                    {
                        error:
                            "Owner accounts cannot be terminated here."
                    },
                    403,
                    origin
                );
            }

            await env.DB.prepare(`
                UPDATE accounts
                SET active = ?
                WHERE id = ?
            `)
                .bind(active, id)
                .run();

            if (!active) {
                await env.DB.prepare(`
                    DELETE FROM sessions
                    WHERE account_id = ?
                `)
                    .bind(id)
                    .run();
            }

            return json(
                {
                    success: true,
                    active: Boolean(active)
                },
                200,
                origin
            );
        }

        /*
         * ============================================================
         * GUEST CHAT: CREATE
         * ============================================================
         */

        if (
            request.method === "POST" &&
            path === "/guest/conversations"
        ) {
            const body = await readJson(request);

            const name = String(
                body.name || ""
            ).trim();

            const contact = String(
                body.contact || ""
            ).trim();

            const message = String(
                body.message || ""
            ).trim();

            if (!name) {
                return json(
                    {
                        error:
                            "Please enter your name."
                    },
                    400,
                    origin
                );
            }

            if (!contact) {
                return json(
                    {
                        error:
                            "Please enter an email, Discord username, or other contact method."
                    },
                    400,
                    origin
                );
            }

            if (!message) {
                return json(
                    {
                        error:
                            "Please enter a message."
                    },
                    400,
                    origin
                );
            }

            if (name.length > 100) {
                return json(
                    {
                        error:
                            "Name is too long."
                    },
                    400,
                    origin
                );
            }

            if (contact.length > 200) {
                return json(
                    {
                        error:
                            "Contact information is too long."
                    },
                    400,
                    origin
                );
            }

            if (message.length > 4000) {
                return json(
                    {
                        error:
                            "Message is too long."
                    },
                    400,
                    origin
                );
            }

            const guestToken = randomToken();

            const conversation =
                await env.DB.prepare(`
                    INSERT INTO conversations
                    (
                        account_id,
                        status,
                        guest_token,
                        guest_name,
                        guest_contact
                    )
                    VALUES (NULL, 'open', ?, ?, ?)
                `)
                    .bind(
                        guestToken,
                        name,
                        contact
                    )
                    .run();

            const conversationId =
                conversation.meta.last_row_id;

            await env.DB.prepare(`
                INSERT INTO messages
                (
                    conversation_id,
                    sender_account_id,
                    message_text
                )
                VALUES (?, NULL, ?)
            `)
                .bind(
                    conversationId,
                    message
                )
                .run();

            await notifyOwner(
                env,
                `?? New guest message on Adan's portfolio

Guest: ${name}
Contact: ${contact}
Conversation: #${conversationId}

Message:
${message}`
            );

            return json(
                {
                    success: true,
                    conversation_id: conversationId,
                    guest_token: guestToken
                },
                201,
                origin
            );
        }

        /*
         * ============================================================
         * GUEST CHAT: READ MESSAGES
         * ============================================================
         */

        const guestMessagesMatch =
            path.match(
                /^\/guest\/conversations\/([^/]+)\/messages$/
            );

        if (
            request.method === "GET" &&
            guestMessagesMatch
        ) {
            const token =
                decodeURIComponent(
                    guestMessagesMatch[1]
                );

            const conversation =
                await env.DB.prepare(`
                    SELECT id, status
                    FROM conversations
                    WHERE guest_token = ?
                      AND account_id IS NULL
                `)
                    .bind(token)
                    .first();

            if (!conversation) {
                return json(
                    {
                        error:
                            "Guest conversation not found."
                    },
                    404,
                    origin
                );
            }

            const messages =
                await getMessages(
                    env,
                    conversation.id
                );

            return json(
                {
                    conversation,
                    messages
                },
                200,
                origin
            );
        }

        /*
         * ============================================================
         * GUEST CHAT: SEND MESSAGE
         * ============================================================
         */

        if (
            request.method === "POST" &&
            guestMessagesMatch
        ) {
            const token =
                decodeURIComponent(
                    guestMessagesMatch[1]
                );

            const conversation =
                await env.DB.prepare(`
                    SELECT
                        id,
                        status,
                        guest_name,
                        guest_contact
                    FROM conversations
                    WHERE guest_token = ?
                      AND account_id IS NULL
                `)
                    .bind(token)
                    .first();

            if (!conversation) {
                return json(
                    {
                        error:
                            "Guest conversation not found."
                    },
                    404,
                    origin
                );
            }

            if (conversation.status === "closed") {
                return json(
                    {
                        error:
                            "This conversation has been closed."
                    },
                    403,
                    origin
                );
            }

            const body = await readJson(request);

            const message = String(
                body.message || ""
            ).trim();

            if (!message) {
                return json(
                    {
                        error:
                            "Message cannot be empty."
                    },
                    400,
                    origin
                );
            }

            if (message.length > 4000) {
                return json(
                    {
                        error:
                            "Message is too long."
                    },
                    400,
                    origin
                );
            }

            await env.DB.prepare(`
                INSERT INTO messages
                (
                    conversation_id,
                    sender_account_id,
                    message_text
                )
                VALUES (?, NULL, ?)
            `)
                .bind(
                    conversation.id,
                    message
                )
                .run();

            await notifyOwner(
                env,
                `?? New guest reply on Adan's portfolio

Guest: ${conversation.guest_name || "Guest"}
Contact: ${conversation.guest_contact || "Not supplied"}
Conversation: #${conversation.id}

Message:
${message}`
            );

            return json(
                {
                    success: true
                },
                201,
                origin
            );
        }

        /*
         * ============================================================
         * CUSTOMER CHAT: LIST
         * ============================================================
         */

        if (
            request.method === "GET" &&
            path === "/conversations"
        ) {
            const authError =
                requireCustomer(account, origin);

            if (authError) {
                return authError;
            }

            const result = await env.DB.prepare(`
                SELECT
                    id,
                    account_id,
                    status,
                    created_at
                FROM conversations
                WHERE account_id = ?
                ORDER BY id DESC
            `)
                .bind(account.id)
                .all();

            return json(
                {
                    conversations:
                        result.results || []
                },
                200,
                origin
            );
        }

        /*
         * ============================================================
         * CUSTOMER CHAT: CREATE
         * ============================================================
         */

        if (
            request.method === "POST" &&
            path === "/conversations"
        ) {
            const authError =
                requireCustomer(account, origin);

            if (authError) {
                return authError;
            }

            if (account.role !== "customer") {
                return json(
                    {
                        error:
                            "Only customer accounts can create conversations."
                    },
                    403,
                    origin
                );
            }

            const body = await readJson(request);

            const message = String(
                body.message || ""
            ).trim();

            if (!message) {
                return json(
                    {
                        error:
                            "Message cannot be empty."
                    },
                    400,
                    origin
                );
            }

            const conversation =
                await env.DB.prepare(`
                    INSERT INTO conversations
                    (
                        account_id,
                        status
                    )
                    VALUES (?, 'open')
                `)
                    .bind(account.id)
                    .run();

            const conversationId =
                conversation.meta.last_row_id;

            await env.DB.prepare(`
                INSERT INTO messages
                (
                    conversation_id,
                    sender_account_id,
                    message_text
                )
                VALUES (?, ?, ?)
            `)
                .bind(
                    conversationId,
                    account.id,
                    message
                )
                .run();

            await notifyOwner(
                env,
                `?? New customer message on Adan's portfolio

Customer: ${account.display_name}
Email: ${account.email}
Conversation: #${conversationId}

Message:
${message}`
            );

            return json(
                {
                    success: true,
                    conversation_id: conversationId
                },
                201,
                origin
            );
        }

        /*
         * ============================================================
         * CUSTOMER CHAT: READ / SEND
         * ============================================================
         */

        const conversationMessagesMatch =
            path.match(
                /^\/conversations\/(\d+)\/messages$/
            );

        if (
            conversationMessagesMatch
        ) {
            const conversationId =
                Number(
                    conversationMessagesMatch[1]
                );

            const conversation =
                await getConversation(
                    env,
                    conversationId
                );

            if (!conversation) {
                return json(
                    {
                        error:
                            "Conversation not found."
                    },
                    404,
                    origin
                );
            }

            if (
                !account ||
                (
                    account.role !== "owner" &&
                    conversation.account_id !== account.id
                )
            ) {
                return json(
                    {
                        error:
                            "You do not have access to this conversation."
                    },
                    403,
                    origin
                );
            }

            if (request.method === "GET") {
                const messages =
                    await getMessages(
                        env,
                        conversationId
                    );

                return json(
                    {
                        conversation,
                        messages
                    },
                    200,
                    origin
                );
            }

            if (request.method === "POST") {
                if (
                    !account ||
                    (
                        account.role !== "owner" &&
                        account.role !== "customer"
                    )
                ) {
                    return json(
                        {
                            error:
                                "You do not have permission to send messages."
                        },
                        403,
                        origin
                    );
                }

                if (
                    conversation.status === "closed"
                ) {
                    return json(
                        {
                            error:
                                "This conversation has been closed."
                        },
                        403,
                        origin
                    );
                }

                const body =
                    await readJson(request);

                const message = String(
                    body.message || ""
                ).trim();

                if (!message) {
                    return json(
                        {
                            error:
                                "Message cannot be empty."
                        },
                        400,
                        origin
                    );
                }

                await env.DB.prepare(`
                    INSERT INTO messages
                    (
                        conversation_id,
                        sender_account_id,
                        message_text
                    )
                    VALUES (?, ?, ?)
                `)
                    .bind(
                        conversationId,
                        account.id,
                        message
                    )
                    .run();

                await notifyOwner(
                    env,
                    `?? New customer reply

Customer: ${account.display_name}
Email: ${account.email}
Conversation: #${conversationId}

Message:
${message}`
                );

                return json(
                    {
                        success: true
                    },
                    201,
                    origin
                );
            }
        }

        /*
         * ============================================================
         * OWNER: CONVERSATION LIST
         * ============================================================
         */

        if (
            request.method === "GET" &&
            path === "/admin/conversations"
        ) {
            const authError =
                requireOwner(account, origin);

            if (authError) {
                return authError;
            }

            const result = await env.DB.prepare(`
                SELECT
                    c.id,
                    c.account_id,
                    c.status,
                    c.created_at,
                    c.guest_token,
                    c.guest_name,
                    c.guest_contact,
                    a.display_name AS account_name,
                    a.email AS account_email
                FROM conversations c
                LEFT JOIN accounts a
                    ON a.id = c.account_id
                ORDER BY c.id DESC
            `).all();

            return json(
                {
                    conversations:
                        result.results || []
                },
                200,
                origin
            );
        }

        /*
         * ============================================================
         * OWNER: SEND MESSAGE
         * Works for BOTH customers and guests.
         * ============================================================
         */

        const adminConversationMessageMatch =
            path.match(
                /^\/admin\/conversations\/(\d+)\/messages$/
            );

        if (
            request.method === "POST" &&
            adminConversationMessageMatch
        ) {
            const authError =
                requireOwner(account, origin);

            if (authError) {
                return authError;
            }

            const conversationId =
                Number(
                    adminConversationMessageMatch[1]
                );

            const conversation =
                await getConversation(
                    env,
                    conversationId
                );

            if (!conversation) {
                return json(
                    {
                        error:
                            "Conversation not found."
                    },
                    404,
                    origin
                );
            }

            if (
                conversation.status === "closed"
            ) {
                return json(
                    {
                        error:
                            "This conversation has been closed."
                    },
                    403,
                    origin
                );
            }

            const body =
                await readJson(request);

            const message = String(
                body.message || ""
            ).trim();

            if (!message) {
                return json(
                    {
                        error:
                            "Message cannot be empty."
                    },
                    400,
                    origin
                );
            }

            if (message.length > 4000) {
                return json(
                    {
                        error:
                            "Message is too long."
                    },
                    400,
                    origin
                );
            }

            await env.DB.prepare(`
                INSERT INTO messages
                (
                    conversation_id,
                    sender_account_id,
                    message_text
                )
                VALUES (?, ?, ?)
            `)
                .bind(
                    conversationId,
                    account.id,
                    message
                )
                .run();

            return json(
                {
                    success: true
                },
                201,
                origin
            );
        }

        /*
         * ============================================================
         * OWNER: CLOSE / REOPEN CONVERSATION
         * ============================================================
         */

        const conversationStatusMatch =
            path.match(
                /^\/admin\/conversations\/(\d+)\/status$/
            );

        if (
            request.method === "POST" &&
            conversationStatusMatch
        ) {
            const authError =
                requireOwner(account, origin);

            if (authError) {
                return authError;
            }

            const conversationId =
                Number(
                    conversationStatusMatch[1]
                );

            const body =
                await readJson(request);

            const status =
                body.status === "closed"
                    ? "closed"
                    : "open";

            const result =
                await env.DB.prepare(`
                    UPDATE conversations
                    SET status = ?
                    WHERE id = ?
                `)
                    .bind(
                        status,
                        conversationId
                    )
                    .run();

            if (!result.meta.changes) {
                return json(
                    {
                        error:
                            "Conversation not found."
                    },
                    404,
                    origin
                );
            }

            return json(
                {
                    success: true,
                    status
                },
                200,
                origin
            );
        }

        /*
         * ============================================================
         * OWNER: IMAGES LIST
         * ============================================================
         */

        if (
            request.method === "GET" &&
            path === "/admin/images"
        ) {
            const authError =
                requireOwner(account, origin);

            if (authError) {
                return authError;
            }

            const result = await env.DB.prepare(`
                SELECT
                    id,
                    name,
                    url,
                    category,
                    project_id,
                    experience_id,
                    created_at
                FROM images
                ORDER BY id DESC
            `).all();

            return json(
                {
                    images:
                        result.results || []
                },
                200,
                origin
            );
        }

        /*
         * ============================================================
         * OWNER: IMAGE UPLOAD
         * ============================================================
         */

        if (
            request.method === "POST" &&
            path === "/admin/images/upload"
        ) {
            const authError =
                requireOwner(account, origin);

            if (authError) {
                return authError;
            }

            const body =
                await readJson(request);

            if (
                !body.name ||
                !body.mime_type ||
                !body.data_base64
            ) {
                return json(
                    {
                        error:
                            "Image data is required."
                    },
                    400,
                    origin
                );
            }

            if (
                !String(body.mime_type)
                    .startsWith("image/")
            ) {
                return json(
                    {
                        error:
                            "Only image files are allowed."
                    },
                    400,
                    origin
                );
            }

            if (
                String(body.data_base64).length >
                7_000_000
            ) {
                return json(
                    {
                        error:
                            "Image is too large. Maximum is 5 MB."
                    },
                    400,
                    origin
                );
            }

            const uploaded =
                await uploadImageToGitHub(
                    env,
                    {
                        name: body.name,
                        data_base64:
                            body.data_base64
                    }
                );

            const result =
                await env.DB.prepare(`
                    INSERT INTO images
                    (
                        name,
                        url,
                        category,
                        project_id,
                        experience_id
                    )
                    VALUES (?, ?, ?, ?, ?)
                `)
                    .bind(
                        body.name,
                        uploaded.url,
                        body.category ||
                            "general",
                        body.project_id ||
                            null,
                        body.experience_id ||
                            null
                    )
                    .run();

            return json(
                {
                    success: true,
                    id: result.meta.last_row_id,
                    name: body.name,
                    url: uploaded.url,
                    path: uploaded.path
                },
                201,
                origin
            );
        }

        /*
         * ============================================================
         * OWNER: IMAGE METADATA
         * ============================================================
         */

        if (
            request.method === "POST" &&
            path === "/admin/images"
        ) {
            const authError =
                requireOwner(account, origin);

            if (authError) {
                return authError;
            }

            const body =
                await readJson(request);

            if (
                !body.name ||
                !body.url
            ) {
                return json(
                    {
                        error:
                            "Image name and URL are required."
                    },
                    400,
                    origin
                );
            }

            const result =
                await env.DB.prepare(`
                    INSERT INTO images
                    (
                        name,
                        url,
                        category,
                        project_id,
                        experience_id
                    )
                    VALUES (?, ?, ?, ?, ?)
                `)
                    .bind(
                        body.name,
                        body.url,
                        body.category ||
                            "general",
                        body.project_id ||
                            null,
                        body.experience_id ||
                            null
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

        /*
         * ============================================================
         * OWNER: DELETE IMAGE
         * ============================================================
         */

        const imageDeleteMatch =
            path.match(
                /^\/admin\/images\/(\d+)$/
            );

        if (
            request.method === "DELETE" &&
            imageDeleteMatch
        ) {
            const authError =
                requireOwner(account, origin);

            if (authError) {
                return authError;
            }

            const id =
                Number(imageDeleteMatch[1]);

            const result =
                await env.DB.prepare(`
                    DELETE FROM images
                    WHERE id = ?
                `)
                    .bind(id)
                    .run();

            if (!result.meta.changes) {
                return json(
                    {
                        error:
                            "Image not found."
                    },
                    404,
                    origin
                );
            }

            return json(
                {
                    success: true
                },
                200,
                origin
            );
        }

        /*
         * ============================================================
         * Nothing in this module matched.
         * ============================================================
         */

        return null;

    } catch (error) {
        console.error(
            "Portal feature error:",
            error
        );

        return json(
            {
                error:
                    error?.message ||
                    "Portal request failed."
            },
            500,
            origin
        );
    }
}
