const token = location.hash.slice(1);
const details = document.getElementById("details");
const missing = document.getElementById("missing");
const status = document.getElementById("status");
const destination = document.getElementById("destination");
const deleteBtn = document.getElementById("deleteBtn");
const deleteConfirm = document.getElementById("deleteConfirm");

const authHeaders = { Authorization: `Bearer ${token}` };

function showMissing() {
    details.hidden = true;
    missing.hidden = false;
}

async function load() {
    const response = token
        ? await fetch("/api/links/me", { headers: authHeaders })
        : { ok: false };

    if (!response.ok) {
        showMissing();
        return;
    }

    const link = await response.json();

    document.getElementById("shortUrl").textContent = link.shortUrl;
    document.getElementById("scans").textContent = link.scans;
    document.getElementById("recent").textContent = link.scansLast30Days;
    document.getElementById("lastScan").textContent = link.lastScanAt
        ? new Date(link.lastScanAt).toLocaleDateString()
        : "Never";
    destination.value = link.destination;
    details.hidden = false;
}

document.getElementById("editForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    status.textContent = "Saving…";

    const response = await fetch("/api/links/me", {
        method: "PATCH",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ destination: destination.value })
    });
    const body = await response.json().catch(() => ({}));

    if (response.ok) {
        destination.value = body.destination;
        status.textContent = "Saved. Your code now goes to the new address.";
    } else {
        status.textContent = body.message || "Could not save.";
    }
});

deleteBtn.addEventListener("click", () => {
    deleteBtn.hidden = true;
    deleteConfirm.hidden = false;
});

document.getElementById("deleteNo").addEventListener("click", () => {
    deleteBtn.hidden = false;
    deleteConfirm.hidden = true;
});

document.getElementById("deleteYes").addEventListener("click", async () => {
    await fetch("/api/links/me", { method: "DELETE", headers: authHeaders });
    showMissing();
    missing.textContent = "The link was deleted.";
});

load().catch(showMissing);
