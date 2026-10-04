/* ==========================================
   ADAN PORTFOLIO ENGINE
========================================== */

document.addEventListener("DOMContentLoaded", () => {
    const menuToggle = document.querySelector(".menu-toggle");
    const navigation = document.querySelector(".navbar nav");

    if (menuToggle && navigation) {
        navigation.id = "site-navigation";
        menuToggle.addEventListener("click", () => {
            const open = document.body.classList.toggle("menu-open");
            menuToggle.setAttribute("aria-expanded", String(open));
        });
        navigation.querySelectorAll("a").forEach(link => {
            link.addEventListener("click", () => {
                document.body.classList.remove("menu-open");
                menuToggle.setAttribute("aria-expanded", "false");
            });
        });
    }

    /* ==========================================
       YEAR
    ========================================== */

    const year = document.getElementById("year");

    if (year) {
        year.textContent = new Date().getFullYear();
    }


    /* ==========================================
       CURSOR GLOW
    ========================================== */

    const cursorGlow = document.querySelector(".cursor-glow");

    window.addEventListener("mousemove", (event) => {

        if (!cursorGlow) return;

        cursorGlow.style.left = `${event.clientX}px`;
        cursorGlow.style.top = `${event.clientY}px`;

    });


    /* ==========================================
       NAVBAR
    ========================================== */

    const navbar = document.querySelector(".navbar");

    window.addEventListener("scroll", () => {

        if (!navbar) return;

        navbar.classList.toggle(
            "scrolled",
            window.scrollY > 50
        );

    });


    /* ==========================================
       SCROLL REVEAL
    ========================================== */

    const revealElements =
        document.querySelectorAll(
            ".glass-card, .section-heading, .featured-work, .contact-card"
        );

    revealElements.forEach(element => {
        element.classList.add("reveal");
    });

    const revealObserver =
        new IntersectionObserver(
            entries => {

                entries.forEach(entry => {

                    if (entry.isIntersecting) {

                        entry.target.classList.add("visible");

                        revealObserver.unobserve(
                            entry.target
                        );

                    }

                });

            },
            {
                threshold: 0.12
            }
        );

    revealElements.forEach(element => {
        revealObserver.observe(element);
    });


    /* ==========================================
       ACTIVE NAVIGATION
    ========================================== */

    const sections =
        document.querySelectorAll("section[id]");

    const navLinks =
        document.querySelectorAll(".navbar nav a");

    const navObserver =
        new IntersectionObserver(
            entries => {

                entries.forEach(entry => {

                    if (!entry.isIntersecting) {
                        return;
                    }

                    navLinks.forEach(link => {

                        link.classList.remove("active");

                        if (
                            link.getAttribute("href") ===
                            `#${entry.target.id}`
                        ) {
                            link.classList.add("active");
                        }

                    });

                });

            },
            {
                threshold: 0.35
            }
        );

    sections.forEach(section => {
        navObserver.observe(section);
    });


    /* ==========================================
       PROJECT 3D TILT
    ========================================== */

    if (window.matchMedia("(pointer: fine) and (prefers-reduced-motion: no-preference)").matches) {
        document
            .querySelectorAll(".project-card")
            .forEach(card => {
                card.addEventListener("mousemove", event => {
                    const rect = card.getBoundingClientRect();
                    const x = event.clientX - rect.left;
                    const y = event.clientY - rect.top;
                    const rotateY = ((x / rect.width) - 0.5) * 8;
                    const rotateX = ((y / rect.height) - 0.5) * -8;

                    card.style.transform = `perspective(900px)
                        rotateX(${rotateX}deg)
                        rotateY(${rotateY}deg)
                        translateY(-8px)`;
                });

                card.addEventListener("mouseleave", () => {
                    card.style.transform = "";
                });
            });
    }



    /* ==========================================
       EXPERIENCE
    ========================================== */

    loadExperience();


    /* ==========================================
       FEATURED WORK
    ========================================== */

    loadFeaturedWork();


    /* ==========================================
       REVIEWS
    ========================================== */

    loadReviews();


    /* ==========================================
       REVIEW BUTTON
    ========================================== */

    const reviewButton =
        document.getElementById("review-button");

    if (reviewButton) {

        reviewButton.addEventListener("click", () => {

            window.location.href =
                "portal.html?review=true";

        });

    }


    /* ==========================================
       MAGNETIC BUTTONS
    ========================================== */

    if (window.matchMedia("(pointer: fine) and (prefers-reduced-motion: no-preference)").matches) {
        document
            .querySelectorAll(".button")
            .forEach(button => {
                button.addEventListener("mousemove", event => {
                    const rect = button.getBoundingClientRect();
                    const x = event.clientX - rect.left - rect.width / 2;
                    const y = event.clientY - rect.top - rect.height / 2;
                    button.style.transform =
                        `translate(${x * 0.08}px, ${y * 0.08}px)`;
                });

                button.addEventListener("mouseleave", () => {
                    button.style.transform = "";
                });
            });
    }

});


/* ==========================================
   EXPERIENCE LOADER
========================================== */

async function loadExperience() {

    const container =
        document.getElementById("experience-list");

    if (!container) return;

    try {

        const response = await fetchWithFallback(
            "/experience",
            "./data/experience.json"
        );

        const data = Array.isArray(response.experience)
            ? response.experience.reduce((groups, experience) => {
                const category = groups[experience.category] || [];
                category.push(experience);
                groups[experience.category] = category;
                return groups;
            }, {})
            : response;

        container.innerHTML = "";

        const categories = [
            {
                key: "senior",
                title: "Senior Leadership",
                icon: "👑"
            },
            {
                key: "high",
                title: "High Ranking",
                icon: "🏆"
            },
            {
                key: "middle",
                title: "Management",
                icon: "📈"
            },
            {
                key: "entry",
                title: "Entry-Level",
                icon: "🚀"
            }
        ];

        categories.forEach(category => {

            const experiences =
                data[category.key] || [];

            if (!experiences.length) return;

            const header =
                document.createElement("div");

            header.className =
                "experience-category reveal visible";

            header.innerHTML = `
                <div class="experience-category-title">
                    <span>${category.icon}</span>
                    <h3>${category.title}</h3>
                </div>
            `;

            container.appendChild(header);

            experiences.forEach((experience, index) => {

                const item =
                    document.createElement("div");

                item.className =
                    "timeline-item reveal visible";

                item.style.transitionDelay =
                    `${Math.min(index * 40, 500)}ms`;

                item.innerHTML = `
                    <div class="timeline-dot"></div>

                    <div class="timeline-card">

                        <span class="timeline-date">
                            EXPERIENCE
                        </span>

                        <h3>
                            ${escapeHTML(
                                experience.organization
                            )}
                        </h3>

                        <p>
                            ${escapeHTML(
                                experience.role
                            )}
                        </p>

                    </div>
                `;

                container.appendChild(item);

            });

        });

    } catch (error) {

        console.error(error);

        container.innerHTML = `
            <div class="timeline-card">
                <h3>Experience temporarily unavailable</h3>
                <p>Please refresh the page.</p>
            </div>
        `;

    }

}


/* ==========================================
   FEATURED WORK CAROUSEL
========================================== */

async function loadFeaturedWork() {

    const section =
        document.getElementById("projects-list");

    if (!section) return;

    try {

        const data = await fetchWithFallback(
            "/projects",
            "./data/projects.json"
        );
        const projects = normalizeProjects(data);

        if (!projects.length) return;

        section.innerHTML = "";
        renderProjectCards(section, projects);
        const featuredProjects = projects.filter(project => project.featured);
        const carouselProjects = featuredProjects.length ? featuredProjects : projects;

        let current = 0;

        const wrapper =
            document.createElement("div");

        wrapper.className =
            "featured-work";

        section.parentNode.insertBefore(
            wrapper,
            section
        );

        section.style.display = "grid";

        function render() {

            const project = carouselProjects[current];

            wrapper.innerHTML = `
                <div class="featured-content">

                    <span class="featured-number">
                        FEATURED WORK ${String(current + 1).padStart(2, "0")}
                    </span>

                    <h3>
                        ${escapeHTML(project.title)}
                    </h3>

                    <p>
                        ${escapeHTML(project.description)}
                    </p>

                    <div class="project-tags"
                         style="margin-top:22px;">
                        ${project.tags
                            .map(tag =>
                                `<span>${escapeHTML(tag)}</span>`
                            )
                            .join("")}
                    </div>

                </div>

                <div class="featured-controls">

                    <button
                        class="featured-control"
                        id="featured-prev"
                        aria-label="Previous featured project">
                        ←
                    </button>

                    <button
                        class="featured-control"
                        id="featured-next"
                        aria-label="Next featured project">
                        →
                    </button>

                </div>
            `;

            document
                .getElementById("featured-prev")
                .onclick = () => {

                    current =
                    (current - 1 + carouselProjects.length)
                    % carouselProjects.length;

                    render();

                };

            document
                .getElementById("featured-next")
                .onclick = () => {

                    current =
                        (current + 1)
                    % carouselProjects.length;

                    render();

                };

        }

        render();

        setInterval(() => {

            current =
                (current + 1)
                % carouselProjects.length;

            render();

        }, 7000);

    } catch (error) {

        console.error(
            "Featured work error:",
            error
        );

    }

}


/* ==========================================
   REVIEWS
========================================== */

async function loadReviews() {

    const container =
        document.getElementById("reviews-list");

    if (!container) return;

    try {

        const response =
            await fetch("./data/reviews.json");

        if (!response.ok) {
            throw new Error("Reviews unavailable.");
        }

        const data =
            await response.json();

        const reviews =
            data.reviews || [];

        const approvedReviews = reviews.filter(review => review.approved);

        container.innerHTML =
            approvedReviews
                .map(review => `

                    <article class="review-card glass-card">

                        <div class="review-header">

                            <img
                                class="review-avatar"
                                src="${escapeAttribute(
                                    review.avatar
                                )}"
                                alt=""
                            >

                            <div>

                                <div class="review-name">
                                    ${escapeHTML(review.name)}
                                </div>

                                <div class="review-identity">
                                    ${escapeHTML(
                                        review.identity
                                    )}
                                </div>

                            </div>

                        </div>

                        <div class="review-stars">
                            ${"★".repeat(
                                Math.max(
                                    1,
                                    Math.min(
                                        5,
                                        Number(review.rating) || 5
                                    )
                                )
                            )}
                        </div>

                        <p class="review-text">
                            ${escapeHTML(review.text)}
                        </p>

                    </article>

                `)
                .join("") || `
                    <div class="empty-state glass-card">
                        <div class="empty-icon">⭐</div>
                        <h3>No approved reviews yet</h3>
                        <p>Reviews will appear here after they have been submitted and approved.</p>
                    </div>
                `;

    } catch (error) {

        console.error(
            "Review loading error:",
            error
        );

    }

}

const API_BASE = "https://adan-portfolio-api.adanfuau1.workers.dev";

async function fetchWithFallback(apiPath, fallbackPath) {
    try {
        const apiResponse = await fetch(`${API_BASE}${apiPath}`);
        if (apiResponse.ok) {
            return await apiResponse.json();
        }
    } catch (error) {
        console.warn(`API request failed for ${apiPath}; using static data.`, error);
    }

    const fallbackResponse = await fetch(fallbackPath);
    if (!fallbackResponse.ok) {
        throw new Error(`Unable to load ${fallbackPath}.`);
    }
    return fallbackResponse.json();
}

function normalizeProjects(data) {
    const projects = data.projects || data.featured || [];
    return projects.map((project, index) => ({
        title: project.title || "Untitled project",
        description: project.description || "A digital project in development.",
        tags: Array.isArray(project.tags)
            ? project.tags
            : String(project.category || "Development").split(",").map(tag => tag.trim()),
        status: project.status || project.category || "Development",
        icon: project.icon || "✨",
        featured: Boolean(project.featured),
        index
    }));
}

function renderProjectCards(container, projects) {
    container.insertAdjacentHTML("beforeend", projects.map((project, index) => `
        <article class="project-card glass-card">
            <div class="project-top">
                <span class="project-number">${String(index + 1).padStart(2, "0")}</span>
                <span class="project-status">${escapeHTML(project.status)}</span>
            </div>
            <div class="project-icon">${escapeHTML(project.icon)}</div>
            <h3>${escapeHTML(project.title)}</h3>
            <p>${escapeHTML(project.description)}</p>
            <div class="project-tags">
                ${project.tags.map(tag => `<span>${escapeHTML(tag)}</span>`).join("")}
            </div>
        </article>
    `).join(""));
}


/* ==========================================
   SECURITY HELPERS
========================================== */

function escapeHTML(value) {

    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

}

function escapeAttribute(value) {

    return escapeHTML(value);

}
