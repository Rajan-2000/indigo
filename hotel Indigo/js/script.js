/* =========================================================
   indigo line Hotel – site script
   ========================================================= */

/* ---------- SETTINGS (edit these) ---------- */

// Owner's WhatsApp number: country code + number, digits only
const OWNER_WHATSAPP = "917799818118";


const HOTEL_NAME = "indigo line Hotel";

// Google Apps Script "Web app" URL (saves to Google Sheet + sends email).
// Paste it here after deploying google-apps-script.gs. Leave "" to skip.
// const SHEET_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbwYaneSjyKkD0Nwbh0liVkMUBNFA0vvym_DNDRisw_Zk45bIALJmuApAdnJJBYS9QrG0Q/exec";
 const SHEET_WEBHOOK_URL = "";

// Page shown after the guest sends the enquiry (payment QR is on this page)


// true  = also open WhatsApp for the guest after sending
// false = only save to Sheet + email, then go to the thank-you page (recommended)
const ALSO_OPEN_WHATSAPP = true;
const THANK_YOU_PAGE = "thank-you.html";


// Price per night (must match the room names in the <select>)
const ROOM_PRICES = {
  "Standard Room": 1499,
  "Deluxe Room": 1999,
  "Family Room": 2499,
};

// Dates the hotel is already full. Use room: "all" to block every room type.
// "from" and "to" are the first and last blocked NIGHTS (YYYY-MM-DD).
const BLOCKED_DATES = [
  // { room: "Deluxe Room", from: "2026-12-24", to: "2026-12-27" },
  // { room: "all",         from: "2026-12-31", to: "2026-12-31" },
];

/* ---------- Mobile menu ---------- */
const menuButton = document.querySelector(".menu-btn");
const nav = document.querySelector("nav");
if (menuButton && nav) {
  menuButton.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("open");
    menuButton.setAttribute("aria-expanded", String(isOpen));
    menuButton.textContent = isOpen ? "×" : "☰";
  });
}

/* ---------- Footer year ---------- */
document
  .querySelectorAll("[data-year]")
  .forEach((el) => (el.textContent = new Date().getFullYear()));

/* ---------- Date helpers ---------- */
const toISO = (d) => {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};
const addDays = (iso, n) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return toISO(d);
};
const nightsBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
const money = (n) => "₹" + n.toLocaleString("en-IN");
const prettyDate = (iso) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

function isBlocked(room, checkin, checkout) {
  return BLOCKED_DATES.some(
    (b) =>
      (b.room === "all" || b.room === room) &&
      checkin <= b.to &&
      checkout > b.from
  );
}

/* ---------- Calendar limits on every date pair ---------- */
function setupDates(form) {
  const cin = form.elements["checkin"];
  const cout = form.elements["checkout"];
  if (!cin || !cout) return;
  const today = toISO(new Date());
  cin.min = today;
  cout.min = addDays(today, 1);
  cin.addEventListener("change", () => {
    if (!cin.value) return;
    cout.min = addDays(cin.value, 1);
    if (cout.value && cout.value <= cin.value) cout.value = "";
    if (!cout.value) cout.value = addDays(cin.value, 1);
  });
}

document.querySelectorAll("form[data-date-form]").forEach(setupDates);

/* ---------- Booking form logic (used by the pop-up AND the contact page) ---------- */
function prefillForm(form, values) {
  Object.entries(values || {}).forEach(([key, v]) => {
    const el = form.elements[key];
    if (!v || !el) return;
    if (el.tagName === "SELECT" && ![...el.options].some((o) => o.value === String(v))) return;
    el.value = v;
  });
  const cin = form.elements["checkin"];
  const cout = form.elements["checkout"];
  if (cin && cin.value && cout) cout.min = addDays(cin.value, 1);
  form.dispatchEvent(new Event("input", { bubbles: true }));
}

function initBookingForm(form) {
  const f = (name) => form.elements[name];
  const notice = form.querySelector(".notice");
  const summary = form.querySelector(".booking-summary");

  setupDates(form);

  function showNotice(text, type) {
    if (!notice) return;
    notice.textContent = text;
    notice.classList.toggle("error", type === "error");
    notice.style.display = "block";
  }

  function getTotals() {
    const room = f("room").value;
    const checkin = f("checkin").value;
    const checkout = f("checkout").value;
    const rooms = parseInt(f("rooms").value, 10) || 1;
    const nights = checkin && checkout ? nightsBetween(checkin, checkout) : 0;
    const price = ROOM_PRICES[room] || 0;
    return { room, checkin, checkout, rooms, nights, price, total: nights > 0 ? price * nights * rooms : 0 };
  }

  function updateSummary() {
    if (!summary) return;
    const t = getTotals();
    if (t.nights > 0 && t.price) {
      summary.innerHTML =
        `<strong>${t.room}</strong> × ${t.rooms} room${t.rooms > 1 ? "s" : ""} · ` +
        `${t.nights} night${t.nights > 1 ? "s" : ""} ` +
        `(${prettyDate(t.checkin)} → ${prettyDate(t.checkout)})<br>` +
        `Estimated total: <strong>${money(t.total)}</strong>` +
        `<small>Indicative price. The hotel will confirm the final amount and availability.</small>`;
      summary.classList.add("show");
    } else {
      summary.classList.remove("show");
    }
  }

  form.addEventListener("change", updateSummary);
  form.addEventListener("input", updateSummary);
  updateSummary();

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const get = (k) => (f(k) ? f(k).value : "").toString().trim();
    const t = getTotals();

    if (!get("name")) return showNotice("Please enter your name.", "error");
    if (get("phone").replace(/\D/g, "").length < 10)
      return showNotice("Please enter a valid phone number.", "error");
    if (!t.checkin || !t.checkout)
      return showNotice("Please choose check-in and check-out dates.", "error");
    if (t.nights < 1)
      return showNotice("Check-out must be after check-in.", "error");
    if (isBlocked(t.room, t.checkin, t.checkout))
      return showNotice(
        `Sorry, ${t.room} is not available for those dates. Please try other dates or another room type.`,
        "error"
      );

    const lines = [
      `*New Booking Enquiry – ${HOTEL_NAME}*`,
      "",
      `*Name:* ${get("name")}`,
      `*Phone:* ${get("phone")}`,
      `*Email:* ${get("email") || "-"}`,
      `*City:* ${get("city") || "-"}`,
      "",
      `*Room type:* ${t.room}`,
      `*Rooms:* ${t.rooms}`,
      `*Guests:* ${get("adults") || 1} adult(s), ${get("children") || 0} child(ren)`,
      `*Check-in:* ${prettyDate(t.checkin)}`,
      `*Check-out:* ${prettyDate(t.checkout)}`,
      `*Nights:* ${t.nights}`,
      `*Estimated total:* ${money(t.total)}`,
      `*Arrival time:* ${get("arrival") || "-"}`,
      `*Purpose:* ${get("purpose") || "-"}`,
      "",
      `*Special requests:* ${get("message") || "-"}`,
    ];

    const payload = {
      name: get("name"),
      phone: get("phone"),
      email: get("email"),
      city: get("city"),
      arrival: get("arrival"),
      purpose: get("purpose"),
      room: t.room,
      rooms: t.rooms,
      adults: get("adults") || 1,
      children: get("children") || 0,
      checkin: t.checkin,
      checkout: t.checkout,
      nights: t.nights,
      total: t.total,
      message: get("message"),
      website: get("website"), // honeypot (must stay empty)
    };

    const whatsappURL = `https://wa.me/${OWNER_WHATSAPP}?text=${encodeURIComponent(lines.join("\n"))}`;

window.open(whatsappURL, "_blank");

setTimeout(() => {
    window.location.href = THANK_YOU_PAGE;
}, 1000);

    // 1) Optional WhatsApp for the guest (must open straight away on click)
    if (ALSO_OPEN_WHATSAPP || !SHEET_WEBHOOK_URL) {
      const url = `https://wa.me/${OWNER_WHATSAPP}?text=${encodeURIComponent(lines.join("\n"))}`;
      window.open(url, "_blank", "noopener");
    }

    // 2) Remember the booking so the thank-you page can show it
    try {
      sessionStorage.setItem(
        "lastBooking",
        JSON.stringify({
          name: payload.name, phone: payload.phone, room: t.room, rooms: t.rooms,
          checkin: t.checkin, checkout: t.checkout, nights: t.nights, total: t.total,
        })
      );
    } catch (err) {}

    const goThankYou = () => { window.location.href = THANK_YOU_PAGE; };
    if (!SHEET_WEBHOOK_URL) return goThankYou();

    // 3) Save to Google Sheet (+ email), then open the thank-you page
    const submitBtn = form.querySelector('[type="submit"]');
    const label = submitBtn ? submitBtn.textContent : "";
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Sending…"; }

    const saved = fetch(SHEET_WEBHOOK_URL, {
      method: "POST",
      mode: "no-cors",
      keepalive: true,
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
    const waitMax = new Promise((resolve) => setTimeout(resolve, 6000));

    Promise.race([saved, waitMax])
      .then(goThankYou)
      .catch(() => {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = label; }
        showNotice("Could not send your enquiry. Please check your internet and try again, or WhatsApp us directly.", "error");
      });
  });
}

/* ---------- Contact page: inline form ---------- */
const inlineForms = document.querySelectorAll("form[data-booking-form]");
inlineForms.forEach((form) => {
  initBookingForm(form);
  // Pre-fill from links like contact.html?room=Deluxe%20Room&checkin=2026-12-01
  const p = new URLSearchParams(location.search);
  prefillForm(form, {
    room: p.get("room"),
    checkin: p.get("checkin"),
    checkout: p.get("checkout"),
    adults: p.get("adults"),
  });
});

/* ---------- Other pages: booking pop-up on the same page ---------- */
let modal = null;
let modalForm = null;
let lastFocus = null;

if (!inlineForms.length) {
  const opts = (vals, sel) =>
    vals.map((v) => `<option value="${v}"${String(v) === String(sel) ? " selected" : ""}>${v}</option>`).join("");
  const roomOpts = Object.entries(ROOM_PRICES)
    .map(([name, price]) => `<option value="${name}">${name} – ${money(price)} / night</option>`)
    .join("");

  modal = document.createElement("div");
  modal.className = "modal";
  modal.hidden = true;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "bookTitle");
  modal.innerHTML = `
    <div class="modal-box">
      <button type="button" class="modal-close" aria-label="Close booking form">×</button>
      <form class="contact-form" data-booking-form novalidate>
        <h2 id="bookTitle" class="modal-title">Book your stay</h2>
        <div class="form-grid">
          <div class="field"><label for="m-name">Your name *</label>
            <input id="m-name" name="name" placeholder="Full name" required /></div>
          <div class="field"><label for="m-phone">Phone number *</label>
            <input id="m-phone" name="phone" type="tel" placeholder="+91" required /></div>
          <div class="field"><label for="m-email">Email address</label>
            <input id="m-email" name="email" type="email" placeholder="you@example.com" /></div>
          <div class="field"><label for="m-city">City / Address</label>
            <input id="m-city" name="city" placeholder="Your city" /></div>
          <div class="field"><label for="m-checkin">Check-in date *</label>
            <input id="m-checkin" name="checkin" type="date" required /></div>
          <div class="field"><label for="m-checkout">Check-out date *</label>
            <input id="m-checkout" name="checkout" type="date" required /></div>
          <div class="field full"><label for="m-room">Room type</label>
            <select id="m-room" name="room">${roomOpts}</select></div>
          <div class="row3">
            <div class="field"><label for="m-rooms">Rooms</label>
              <select id="m-rooms" name="rooms">${opts([1, 2, 3, 4, 5], 1)}</select></div>
            <div class="field"><label for="m-adults">Adults</label>
              <select id="m-adults" name="adults">${opts([1, 2, 3, 4, 5, 6], 2)}</select></div>
            <div class="field"><label for="m-children">Children</label>
              <select id="m-children" name="children">${opts([0, 1, 2, 3, 4], 0)}</select></div>
          </div>
          <div class="field"><label for="m-arrival">Expected arrival time</label>
            <input id="m-arrival" name="arrival" type="time" /></div>
          <div class="field"><label for="m-purpose">Purpose of visit</label>
            <select id="m-purpose" name="purpose">
              <option value="Leisure">Leisure / Holiday</option>
              <option value="Business">Business</option>
              <option value="Family">Family visit / Function</option>
              <option value="Other">Other</option>
            </select></div>
          <div class="field full"><label for="m-message">Special requests</label>
            <textarea id="m-message" name="message" placeholder="Arrival time, extra bed, breakfast, airport pickup..."></textarea></div>
          <div style="position:absolute;left:-9999px" aria-hidden="true">
            <input name="website" tabindex="-1" autocomplete="off" />
          </div>
          <div class="field full">
            <div class="booking-summary" aria-live="polite"></div>
            <button class="btn" type="submit">Send Booking Enquiry</button>
            <div class="notice"></div>
          </div>
        </div>
      </form>
    </div>`;
  document.body.appendChild(modal);
  modalForm = modal.querySelector("form");
  initBookingForm(modalForm);

  const closeModal = () => {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    if (lastFocus) lastFocus.focus();
  };

  window.openBooking = (values) => {
    lastFocus = document.activeElement;
    const notice = modalForm.querySelector(".notice");
    notice.style.display = "none";
    prefillForm(modalForm, values);
    modal.hidden = false;
    document.body.classList.add("modal-open");
    setTimeout(() => modalForm.elements["name"].focus(), 50);
  };

  modal.querySelector(".modal-close").addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) closeModal();
  });

  // Any "Book" button opens the pop-up instead of leaving the page
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (!a || !a.matches("[data-book], .nav-wrap > .btn, .room-card .btn")) return;
    e.preventDefault();
    const q = new URL(a.href, location.href).searchParams;
    window.openBooking({ room: q.get("room"), checkin: q.get("checkin"), checkout: q.get("checkout"), adults: q.get("adults") });
  });

  // Home-page search strip: open the pop-up with the chosen dates
  document.querySelectorAll("form[data-date-form]").forEach((strip) => {
    strip.addEventListener("submit", (e) => {
      e.preventDefault();
      const g = (n) => (strip.elements[n] ? strip.elements[n].value : "");
      window.openBooking({ checkin: g("checkin"), checkout: g("checkout"), adults: g("adults"), room: g("room") });
    });
  });
}