const form = document.getElementById("qrForm");
const generateBtn = document.getElementById("generateBtn");
const status = document.getElementById("status");
const result = document.getElementById("result");
const qrPreview = document.getElementById("qrPreview");
const downloadBtn = document.getElementById("downloadBtn");
const content = document.getElementById("content");
const iconInput = document.getElementById("icon");
const dropzone = document.getElementById("dropzone");
const dropEmpty = document.getElementById("dropEmpty");
const dropPreview = document.getElementById("dropPreview");
const iconPreview = document.getElementById("iconPreview");
const iconName = document.getElementById("iconName");
const clearIcon = document.getElementById("clearIcon");

const placeholders = {
    url: "https://example.com",
    text: "Hello from Giraso",
    json: '{"hello":"giraso"}'
};

let objectUrl = null;
let iconObjectUrl = null;

function clearPreview() {
    if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
    }

    qrPreview.removeAttribute("src");
    downloadBtn.removeAttribute("href");
    result.hidden = true;
}

function setIconPreview(file) {
    if (iconObjectUrl) {
        URL.revokeObjectURL(iconObjectUrl);
        iconObjectUrl = null;
    }

    if (!file) {
        iconPreview.removeAttribute("src");
        iconName.textContent = "";
        dropEmpty.hidden = false;
        dropPreview.hidden = true;
        return;
    }

    iconObjectUrl = URL.createObjectURL(file);
    iconPreview.src = iconObjectUrl;
    iconName.textContent = file.name;
    dropEmpty.hidden = true;
    dropPreview.hidden = false;
}

function clearIconFile(event) {
    event.preventDefault();
    event.stopPropagation();
    iconInput.value = "";
    setIconPreview(null);
}

function openPicker() {
    iconInput.click();
}

form.querySelectorAll('input[name="type"]').forEach((input) => {
    input.addEventListener("change", () => {
        content.placeholder = placeholders[input.value] || placeholders.url;
    });
});

dropzone.addEventListener("click", (event) => {
    if (event.target === clearIcon || clearIcon.contains(event.target)) {
        return;
    }

    openPicker();
});

dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openPicker();
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

    if (!file) {
        return;
    }

    const transfer = new DataTransfer();
    transfer.items.add(file);
    iconInput.files = transfer.files;
    setIconPreview(file);
});

iconInput.addEventListener("change", () => {
    setIconPreview(iconInput.files?.[0] || null);
});

clearIcon.addEventListener("click", clearIconFile);

form.addEventListener("submit", async (event) => {
    event.preventDefault();

    generateBtn.disabled = true;
    generateBtn.textContent = "Generating…";
    status.textContent = "Working…";
    clearPreview();

    try {
        const response = await fetch("/api/generate", {
            method: "POST",
            body: new FormData(form)
        });

        const contentType = response.headers.get("content-type") || "";

        if (!response.ok || !contentType.includes("image/")) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || "Generation failed.");
        }

        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);

        qrPreview.src = objectUrl;
        downloadBtn.href = objectUrl;
        result.hidden = false;
        status.textContent = "Ready to download.";
    } catch (error) {
        status.textContent = error.message;
    } finally {
        generateBtn.disabled = false;
        generateBtn.textContent = "Generate";
    }
});
