const GENRE_OPTIONS = {
    'hip-hop': ['Rap', 'Trap', 'Drill', 'Melodic Rap', 'Boom Bap', 'Conscious Hip-Hop', 'Alternative Hip-Hop'],
    'rnb-soul': ['R&B', 'Soul', 'Neo-Soul', 'Alternative R&B', 'Afro-R&B'],
    'pop': ['Dance Pop', 'Indie Pop', 'Electropop', 'Pop Rap'],
    'electronic': ['EDM', 'House', 'Techno', 'Lo-Fi', 'Ambient'],
    'afrobeats': ['Amapiano', 'Afro-Fusion', 'Dancehall', 'Afro Pop'],
    'rock': ['Alternative Rock', 'Indie Rock', 'Pop Rock', 'Punk Rock'],
    'latin': ['Reggaeton', 'Latin Trap', 'Urbano', 'Regional Fusion'],
    'other': ['Singer-Songwriter', 'Experimental', 'Gospel', 'Folk', 'Other']
};

class TrialCampaignForm {
    constructor() {
        this.form = document.getElementById('trialCampaignForm');
        this.genreSelect = document.getElementById('genre');
        this.subgenreSelect = document.getElementById('subgenre');
        this.youtubeInput = document.getElementById('youtubeLink');
        this.youtubePreview = document.getElementById('youtubePreview');
        this.youtubeThumbnail = document.getElementById('youtubeThumbnail');
        this.youtubeWatchLink = document.getElementById('youtubeWatchLink');
        this.formMessage = document.getElementById('formMessage');
        this.submitBtn = document.getElementById('submitBtn');
        this.successState = document.getElementById('successState');
        this.successReference = document.getElementById('successReference');
        this.submitAnotherBtn = document.getElementById('submitAnotherBtn');

        this.youtubePreviewTimer = null;
        this.init();
    }

    init() {
        this.setupGenreField();
        this.setupYouTubePreview();
        this.setupFormSubmit();
        this.setupReset();
    }

    setupGenreField() {
        this.genreSelect.addEventListener('change', () => {
            const genre = this.genreSelect.value;
            const options = GENRE_OPTIONS[genre] || [];

            this.subgenreSelect.innerHTML = options.length
                ? ['<option value="">Select a subgenre</option>', ...options.map((option) => `<option value="${option}">${option}</option>`)].join('')
                : '<option value="">Choose a genre first</option>';

            this.subgenreSelect.disabled = options.length === 0;
        });
    }

    setupYouTubePreview() {
        this.youtubeInput.addEventListener('input', () => {
            window.clearTimeout(this.youtubePreviewTimer);
            this.youtubePreviewTimer = window.setTimeout(() => {
                this.updateYouTubePreview();
            }, 180);
        });
    }

    setupFormSubmit() {
        this.form.addEventListener('submit', async (event) => {
            event.preventDefault();

            if (!this.form.reportValidity()) {
                this.showMessage('Please complete the required fields first.', 'error');
                return;
            }

            const youtubeVideoId = this.extractYouTubeVideoId(this.youtubeInput.value);
            if (!youtubeVideoId) {
                this.youtubeInput.setCustomValidity('Please provide a valid YouTube video link.');
                this.youtubeInput.reportValidity();
                this.showMessage('Please provide a valid YouTube video link.', 'error');
                return;
            }

            this.youtubeInput.setCustomValidity('');

            const payload = {
                fullName: document.getElementById('fullName').value.trim(),
                genre: this.genreSelect.value,
                subgenre: this.subgenreSelect.value,
                yearsMakingMusic: document.getElementById('yearsMakingMusic').value,
                youtubeLink: this.youtubeInput.value.trim(),
                targetRegions: document.getElementById('targetRegions').value.trim(),
                targetAgeGroup: document.getElementById('targetAgeGroup').value
            };

            this.setSubmittingState(true);
            this.showMessage('Submitting your trial campaign brief...', 'success');

            try {
                const response = await fetch('/api/submit-trial-campaign', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });

                const result = await response.json();

                if (!response.ok || !result.success) {
                    throw new Error(result.message || result.error || 'Something went wrong while submitting the form.');
                }

                this.successReference.textContent = result.submissionId;
                this.form.classList.add('is-hidden');
                this.successState.classList.remove('is-hidden');
                this.showMessage('', 'success');
                this.successState.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } catch (error) {
                console.error('Trial campaign submission error:', error);
                this.showMessage(error.message || 'Failed to submit the form. Please try again.', 'error');
            } finally {
                this.setSubmittingState(false);
            }
        });
    }

    setupReset() {
        this.submitAnotherBtn.addEventListener('click', () => {
            this.form.reset();
            this.subgenreSelect.innerHTML = '<option value="">Choose a genre first</option>';
            this.subgenreSelect.disabled = true;
            this.youtubePreview.classList.add('is-hidden');
            this.successState.classList.add('is-hidden');
            this.form.classList.remove('is-hidden');
            this.showMessage('', 'success');
        });
    }

    updateYouTubePreview() {
        const youtubeLink = this.youtubeInput.value.trim();
        const videoId = this.extractYouTubeVideoId(youtubeLink);

        if (!youtubeLink) {
            this.youtubeInput.setCustomValidity('');
            this.youtubePreview.classList.add('is-hidden');
            return;
        }

        if (!videoId) {
            this.youtubeInput.setCustomValidity('Please provide a valid YouTube video link.');
            this.youtubePreview.classList.add('is-hidden');
            return;
        }

        this.youtubeInput.setCustomValidity('');
        this.youtubeThumbnail.src = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
        this.youtubeWatchLink.href = youtubeLink;
        this.youtubePreview.classList.remove('is-hidden');
    }

    extractYouTubeVideoId(urlString) {
        if (!urlString) return '';

        try {
            const url = new URL(urlString.trim());
            const hostname = url.hostname.replace(/^www\./, '');

            if (hostname === 'youtu.be') {
                return url.pathname.split('/').filter(Boolean)[0] || '';
            }

            if (hostname === 'youtube.com' || hostname === 'm.youtube.com' || hostname === 'music.youtube.com') {
                if (url.pathname === '/watch') {
                    return url.searchParams.get('v') || '';
                }

                if (url.pathname.startsWith('/shorts/') || url.pathname.startsWith('/embed/')) {
                    return url.pathname.split('/').filter(Boolean)[1] || '';
                }
            }
        } catch (error) {
            return '';
        }

        return '';
    }

    setSubmittingState(isSubmitting) {
        this.submitBtn.disabled = isSubmitting;
        this.submitBtn.querySelector('.submit-btn-label').textContent = isSubmitting
            ? 'Submitting...'
            : 'Submit Trial Campaign';
    }

    showMessage(message, type) {
        this.formMessage.textContent = message;
        this.formMessage.classList.remove('is-error', 'is-success');

        if (!message) return;

        this.formMessage.classList.add(type === 'error' ? 'is-error' : 'is-success');
    }
}

new TrialCampaignForm();
