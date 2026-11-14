const form = document.getElementById("qrForm");
const status = document.getElementById("status");
const result = document.getElementById("result");
const qrPreview = document.getElementById("qrPreview");
const sizeSelect = document.getElementById("size");
const cta = document.getElementById("cta");
const iconInput = document.getElementById("icon");
const iconShapeGroup = document.getElementById("iconShapeGroup");
const dropzone = document.getElementById("dropzone");
const dropEmpty = document.getElementById("dropEmpty");
const dropPreview = document.getElementById("dropPreview");
const iconPreview = document.getElementById("iconPreview");
const iconName = document.getElementById("iconName");
const clearIcon = document.getElementById("clearIcon");
const urlInput = document.getElementById("url");
const dynamicToggle = document.getElementById("dynamicToggle");
const dynamicCreate = document.getElementById("dynamicCreate");
const dynamicResult = document.getElementById("dynamicResult");
const wifiEncryption = document.getElementById("wifiEncryption");
const wifiPasswordGroup = document.getElementById("wifiPasswordGroup");
const typePicker = document.getElementById("typePicker");
const segments = [...form.querySelectorAll(".segment")];
const navButtons = [...document.querySelectorAll(".bottom-nav [data-group]")];
const shareBtn = document.getElementById("shareBtn");
const installBtn = document.getElementById("installBtn");
const iosHint = document.getElementById("iosHint");

const PREVIEW_DELAY = 350;
const PREVIEW_ICON_SIDE = 256;

let objectUrl = null;
let iconObjectUrl = null;
let previewIcon = null;
let previewTimer = null;
let previewRequest = null;
let dynamicLink = null;
let previewBlob = null;
let installPrompt = null;

// Last type used in each bottom-nav group, so switching tabs comes back to it.
const lastInGroup = {};

const activeType = () => form.querySelector('input[name="type"]:checked').value;
const activePanel = () => form.querySelector(`.fields[data-type="${activeType()}"]`);

function usingDynamic() {
    return activeType() === "url" && dynamicToggle.checked;
}

function buildRequest(format, size, forPreview) {
    const data = new FormData(form);

    data.delete("icon");
    data.set("format", format);
    data.set("size", String(size));

    const icon = forPreview ? previewIcon : iconInput.files?.[0];

    if (icon) {
        data.set("icon", icon);
    }

    if (usingDynamic() && dynamicLink) {
        data.set("url", dynamicLink.shortUrl);
    }

    return data;
}

async function requestImage(data, signal) {
    let response;

    try {
        response = await fetch("/api/generate", { method: "POST", body: data, signal });
    } catch (error) {
        if (error.name === "AbortError") throw error;
        throw new Error(navigator.onLine === false
            ? "You're offline. Connect to the internet to make a code."
            : "Couldn't reach the server. Check your connection and try again.");
    }

    const contentType = response.headers.get("content-type") || "";

    if (!response.ok || !contentType.includes("image/")) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || "Generation failed.");
    }

    return {
        blob: await response.blob(),
        bytes: response.headers.get("x-qr-bytes"),
        limit: response.headers.get("x-qr-limit")
    };
}

function hidePreview() {
    if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
    }

    qrPreview.removeAttribute("src");
    previewBlob = null;
    result.hidden = true;
    result.classList.remove("is-stale");
}

function cancelPreview() {
    clearTimeout(previewTimer);
    previewRequest?.abort();
    previewRequest = null;
}

async function updatePreview() {
    cancelPreview();

    const primary = activePanel().querySelector("[data-primary]");
    const waitingForLink = usingDynamic() && !dynamicLink;

    if (!primary.value.trim() || waitingForLink) {
        hidePreview();
        status.textContent = waitingForLink && primary.value.trim()
            ? "Create the editable link to get your code."
            : "";
        return;
    }

    const request = new AbortController();
    previewRequest = request;

    try {
        const { blob, bytes, limit } = await requestImage(buildRequest("png", 480, true), request.signal);

        if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
        }

        objectUrl = URL.createObjectURL(blob);
        previewBlob = blob;
        qrPreview.src = objectUrl;
        result.hidden = false;
        result.classList.remove("is-stale");
        status.textContent = `${bytes} of ${limit} bytes used`;
    } catch (error) {
        if (error.name !== "AbortError") {
            hidePreview();
            status.textContent = error.message;
        }
    }
}

function schedulePreview() {
    cancelPreview();
    result.classList.add("is-stale");
    previewTimer = setTimeout(updatePreview, PREVIEW_DELAY);
}

function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function download(button) {
    const format = button.dataset.format;
    const label = button.textContent;

    button.disabled = true;
    button.textContent = "Preparing…";

    try {
        const { blob } = await requestImage(buildRequest(format, sizeSelect.value, false));
        const extension = format === "jpeg" ? "jpg" : format;

        saveBlob(blob, `giraso-qr.${extension}`);
        cta.hidden = false;
    } catch (error) {
        status.textContent = error.message;
    } finally {
        button.disabled = false;
        button.textContent = label;
    }
}

/** Live preview uses a small copy of the icon, so slow connections aren't re-sending megabytes. */
async function shrinkIcon(file) {
    const url = URL.createObjectURL(file);

    try {
        const image = new Image();
        image.src = url;
        await image.decode();

        const scale = PREVIEW_ICON_SIDE / Math.max(image.naturalWidth, image.naturalHeight);
        const canvas = document.createElement("canvas");

        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);

        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        return blob ? new File([blob], "icon.png", { type: "image/png" }) : file;
    } catch {
        return file;
    } finally {
        URL.revokeObjectURL(url);
    }
}

async function setIcon(file) {
    if (iconObjectUrl) {
        URL.revokeObjectURL(iconObjectUrl);
        iconObjectUrl = null;
    }

    dropEmpty.hidden = Boolean(file);
    dropPreview.hidden = !file;
    iconShapeGroup.hidden = !file;

    if (file) {
        iconObjectUrl = URL.createObjectURL(file);
        iconPreview.src = iconObjectUrl;
        iconName.textContent = file.name;
        previewIcon = await shrinkIcon(file);
    } else {
        iconPreview.removeAttribute("src");
        iconName.textContent = "";
        previewIcon = null;
    }

    schedulePreview();
}

function showPanel() {
    form.querySelectorAll(".fields").forEach((panel) => {
        panel.hidden = panel !== activePanel();
    });

    syncGroup();
    schedulePreview();
}

const segmentFor = (type) => form.querySelector(`input[name="type"][value="${type}"]`)?.closest(".segment");

/** Mobile and tablet: the bottom nav picks a group, the switcher shows only that group's types. */
function syncGroup() {
    const group = segmentFor(activeType()).dataset.group;
    const members = segments.filter((segment) => segment.dataset.group === group);

    lastInGroup[group] = activeType();
    segments.forEach((segment) => segment.classList.toggle("out-of-group", segment.dataset.group !== group));
    typePicker.classList.toggle("single-type", members.length < 2);

    navButtons.forEach((button) => {
        const active = button.dataset.group === group;
        button.classList.toggle("is-active", active);

        if (active) {
            button.setAttribute("aria-current", "true");
        } else {
            button.removeAttribute("aria-current");
        }
    });
}

function selectType(type) {
    const input = segmentFor(type)?.querySelector("input");

    if (input && !input.checked) {
        input.checked = true;
        showPanel();
    }
}

function syncDynamic() {
    const on = dynamicToggle.checked;

    dynamicCreate.hidden = !on || Boolean(dynamicLink);
    dynamicResult.hidden = !on || !dynamicLink;
    urlInput.readOnly = on && Boolean(dynamicLink);
}

async function createDynamicLink() {
    dynamicCreate.disabled = true;

    try {
        const response = await fetch("/api/links", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ destination: urlInput.value })
        });
        const body = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(body.message || "Could not create the link.");
        }

        dynamicLink = body;
        document.getElementById("dynamicShort").textContent = body.shortUrl;
        document.getElementById("dynamicManage").textContent = body.manageUrl;
        document.getElementById("dynamicOpen").href = body.manageUrl;
        syncDynamic();
        updatePreview();
    } catch (error) {
        status.textContent = error.message;
    } finally {
        dynamicCreate.disabled = false;
    }
}

form.addEventListener("submit", (event) => event.preventDefault());

form.addEventListener("input", (event) => {
    if (event.target !== iconInput && event.target.name !== "type" && event.target !== dynamicToggle) {
        schedulePreview();
    }
});

form.querySelectorAll('input[name="type"]').forEach((input) => {
    input.addEventListener("change", showPanel);
});

navButtons.forEach((button) => {
    button.addEventListener("click", () => {
        const group = button.dataset.group;
        const first = segments.find((segment) => segment.dataset.group === group).querySelector("input").value;

        selectType(lastInGroup[group] || first);
        window.scrollTo({ top: 0, behavior: "smooth" });
        activePanel().querySelector("[data-primary]")?.focus({ preventScroll: true });
    });
});

wifiEncryption.addEventListener("change", () => {
    wifiPasswordGroup.hidden = wifiEncryption.value === "nopass";
});

dynamicToggle.addEventListener("change", () => {
    syncDynamic();
    schedulePreview();
});

dynamicCreate.addEventListener("click", createDynamicLink);

document.getElementById("dynamicCopy").addEventListener("click", async (event) => {
    await navigator.clipboard.writeText(dynamicLink.manageUrl);
    event.target.textContent = "Copied";
});

document.getElementById("dynamicReset").addEventListener("click", () => {
    dynamicLink = null;
    urlInput.value = "";
    document.getElementById("dynamicCopy").textContent = "Copy private link";
    syncDynamic();
    schedulePreview();
});

result.addEventListener("click", (event) => {
    const button = event.target.closest("[data-format]");

    if (button) {
        download(button);
    }
});

dropzone.addEventListener("click", (event) => {
    if (!clearIcon.contains(event.target)) {
        iconInput.click();
    }
});

dropzone.addEventListener("keydown", (event) => {
    if (event.target === dropzone && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        iconInput.click();
    }
});

["dragenter", "dragover"].forEach((type) => {
    dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        dropzone.classList.add("is-dragging");
    });
});

["dragleave", "dragend", "drop"].forEach((type) => {
    dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        dropzone.classList.remove("is-dragging");
    });
});

dropzone.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];

    if (file) {
        const transfer = new DataTransfer();
        transfer.items.add(file);
        iconInput.files = transfer.files;
        setIcon(file);
    }
});

iconInput.addEventListener("change", () => {
    setIcon(iconInput.files?.[0] || null);
});

clearIcon.addEventListener("click", (event) => {
    event.stopPropagation();
    iconInput.value = "";
    setIcon(null);
});

/* ---------- Share ---------- */

function canShareFiles() {
    try {
        return Boolean(navigator.canShare?.({ files: [new File([""], "qr.png", { type: "image/png" })] }));
    } catch {
        return false;
    }
}

shareBtn.hidden = !canShareFiles();

shareBtn.addEventListener("click", async () => {
    if (!previewBlob) return;

    // Uses the preview already on screen, so the share sheet opens straight from the tap.
    const file = new File([previewBlob], "giraso-qr.png", { type: "image/png" });

    try {
        await navigator.share({ files: [file], title: "QR code" });
        cta.hidden = false;
    } catch (error) {
        if (error.name !== "AbortError") {
            status.textContent = "Sharing isn't available here. Download the PNG instead.";
        }
    }
});

/* ---------- Opened from a shortcut, a shared link or ?type= ---------- */

function applyLaunchParams() {
    const params = new URLSearchParams(location.search);
    const type = params.get("type");
    const sharedUrl = params.get("url");
    const sharedText = [params.get("title"), params.get("text")].filter(Boolean).join(" ").trim();
    const linkInText = sharedText.match(/https?:\/\/\S+/)?.[0];

    if (sharedUrl || linkInText) {
        selectType("url");
        urlInput.value = sharedUrl || linkInText;
    } else if (sharedText) {
        selectType("text");
        document.getElementById("text").value = sharedText;
    } else if (type) {
        selectType(type);
    }

    if (location.search) {
        history.replaceState(null, "", location.pathname);
    }

    syncGroup();

    if (sharedUrl || sharedText) {
        schedulePreview();
    }
}

applyLaunchParams();

/* ---------- Install ---------- */

const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

if (isIos && !isStandalone()) {
    installBtn.hidden = false;
}

window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    installBtn.hidden = false;
});

window.addEventListener("appinstalled", () => {
    installPrompt = null;
    installBtn.hidden = true;
    iosHint.hidden = true;
});

installBtn.addEventListener("click", async () => {
    if (!installPrompt) {
        iosHint.hidden = !iosHint.hidden;
        return;
    }

    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;

    installPrompt = null;

    if (outcome === "accepted") {
        installBtn.hidden = true;
    }
});

document.addEventListener("pointerdown", (event) => {
    if (!iosHint.hidden && !iosHint.contains(event.target) && !installBtn.contains(event.target)) {
        iosHint.hidden = true;
    }
});

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
}
