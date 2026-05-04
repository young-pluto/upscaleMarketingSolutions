function loadSubmission() {
    try {
        const raw = window.sessionStorage.getItem('trialCampaignLastSubmission');
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        return null;
    }
}

function populateSuccessPage() {
    const submission = loadSubmission();
    const referenceEl = document.getElementById('submissionReference');
    const previewEl = document.getElementById('resultVideoPreview');
    const thumbnailEl = document.getElementById('resultThumbnail');
    const videoLinkEl = document.getElementById('resultVideoLink');

    if (!submission) {
        referenceEl.textContent = 'Will be shared by our team';
        return;
    }

    referenceEl.textContent = submission.submissionId || 'Pending';

    if (submission.youtubeThumbnailUrl && submission.youtubeLink) {
        thumbnailEl.src = submission.youtubeThumbnailUrl;
        videoLinkEl.href = submission.youtubeLink;
        previewEl.classList.remove('is-hidden');
    }
}

populateSuccessPage();
