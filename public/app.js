
const form = document.getElementById("qrForm");
const generateBtn = document.getElementById("generateBtn");
const status = document.getElementById("status");

const result = document.getElementById("result");
const qrPreview = document.getElementById("qrPreview");
const shareURL = document.getElementById("shareURL");
const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");

form.addEventListener("submit", async (event) => {
    event.preventDefault();

    generateBtn.disabled = true;
    generateBtn.textContent = "Generating...";
    status.textContent = "Please wait...";

    result.hidden = true;

    try {
        const formData = new FormData(form);

        const response = await fetch("/api/generate", {
            method: "POST",
            body: formData
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.message || "Generation failed.");
        }

        // Display generated QR code
        qrPreview.src = data.shareURL;

        // Share URL
        shareURL.value = data.shareURL;

        // Download URL
        downloadBtn.href = data.shareURL;

        result.hidden = false;
        status.textContent = "QR code generated successfully!";

    } catch (error) {
        status.textContent = error.message;
    } finally {
        generateBtn.disabled = false;
        generateBtn.textContent = "Generate QR Code";
    }
});

// Copy share link
copyBtn.addEventListener("click", async () => {
    try {
        await navigator.clipboard.writeText(shareURL.value);
        copyBtn.textContent = "Copied!";

        setTimeout(() => {
            copyBtn.textContent = "Copy";
        }, 2000);

    } catch {
        shareURL.select();
        document.execCommand("copy");
        copyBtn.textContent = "Copied!";
    }
});
