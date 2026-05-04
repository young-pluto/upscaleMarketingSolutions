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
        this.backBtn = document.getElementById('backBtn');
        this.nextBtn = document.getElementById('nextBtn');
        this.submitBtn = document.getElementById('submitBtn');
        this.progressFill = document.getElementById('stepProgressFill');
        this.stepItems = Array.from(document.querySelectorAll('.step-progress-item'));
        this.steps = Array.from(document.querySelectorAll('.form-step'));
        this.currentStep = 1;
        this.maxSteps = this.steps.length;
        this.nextLabels = {
            1: 'Continue',
            2: 'Proceed'
        };

        this.youtubePreviewTimer = null;
        this.init();
    }

    init() {
        this.setupStepNavigation();
        this.setupGenreField();
        this.setupYouTubePreview();
        this.setupFormSubmit();
        this.updateStepUI();
    }

    setupStepNavigation() {
        this.nextBtn.addEventListener('click', () => {
            if (!this.validateStep(this.currentStep)) return;
            this.goToStep(this.currentStep + 1);
        });

        this.backBtn.addEventListener('click', () => {
            this.goToStep(this.currentStep - 1);
        });
    }

    setupGenreField() {
        this.genreSelect.addEventListener('change', () => {
            const genre = this.genreSelect.value;
            const options = GENRE_OPTIONS[genre] || [];

            this.subgenreSelect.innerHTML = options.length
                ? ['<option value="">Select a subgenre</option>', ...options.map((option) => `<option value="${option}">${option}</option>`)].join('')
                : '<option value="">Choose a genre first</option>';

            this.subgenreSelect.disabled = options.length === 0;
            const subgenreFrame = document.getElementById('subgenreFrame');
            if (subgenreFrame) {
                subgenreFrame.classList.toggle('is-disabled', options.length === 0);
            }
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

    goToStep(step) {
        if (step < 1 || step > this.maxSteps) return;
        this.currentStep = step;
        this.showMessage('', 'success');
        this.updateStepUI();
        this.form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    updateStepUI() {
        this.steps.forEach((stepEl) => {
            const stepNumber = Number(stepEl.dataset.step);
            stepEl.classList.toggle('active', stepNumber === this.currentStep);
        });

        this.stepItems.forEach((item) => {
            const stepNumber = Number(item.dataset.step);
            item.classList.toggle('active', stepNumber === this.currentStep);
            item.classList.toggle('complete', stepNumber < this.currentStep);
        });

        const progressPercent = (this.currentStep / this.maxSteps) * 100;
        this.progressFill.style.width = `${progressPercent}%`;

        this.backBtn.classList.toggle('is-hidden', this.currentStep === 1);
        this.nextBtn.classList.toggle('is-hidden', this.currentStep === this.maxSteps);
        this.submitBtn.classList.toggle('is-hidden', this.currentStep !== this.maxSteps);
        if (this.nextLabels[this.currentStep]) {
            this.nextBtn.textContent = this.nextLabels[this.currentStep];
        }
    }

    validateStep(stepNumber) {
        const fieldsByStep = {
            1: [document.getElementById('fullName'), this.genreSelect],
            2: [document.getElementById('yearsMakingMusic'), this.youtubeInput],
            3: [document.getElementById('targetAgeGroup')]
        };

        const fields = fieldsByStep[stepNumber] || [];

        for (const field of fields) {
            if (!field) continue;

            if (field === this.youtubeInput) {
                const youtubeVideoId = this.extractYouTubeVideoId(this.youtubeInput.value);
                if (!youtubeVideoId) {
                    this.youtubeInput.setCustomValidity('Please provide a valid YouTube video link.');
                    this.youtubeInput.reportValidity();
                    this.showMessage('Please provide a valid YouTube video link.', 'error');
                    return false;
                }
                this.youtubeInput.setCustomValidity('');
            }

            if (!field.reportValidity()) {
                this.showMessage('Please complete this step before continuing.', 'error');
                return false;
            }
        }

        return true;
    }

    setupFormSubmit() {
        this.form.addEventListener('submit', async (event) => {
            event.preventDefault();

            if (!this.validateStep(this.currentStep) || !this.form.reportValidity()) {
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
            this.showMessage('Submitting your campaign intake...', 'success');

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

                const videoId = this.extractYouTubeVideoId(payload.youtubeLink);
                window.sessionStorage.setItem('trialCampaignLastSubmission', JSON.stringify({
                    submissionId: result.submissionId,
                    fullName: payload.fullName,
                    genre: payload.genre,
                    youtubeLink: payload.youtubeLink,
                    youtubeVideoId: videoId,
                    youtubeThumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
                }));

                window.location.href = '/trial-campaign-success';
            } catch (error) {
                console.error('Trial campaign submission error:', error);
                this.showMessage(error.message || 'Failed to submit the form. Please try again.', 'error');
            } finally {
                this.setSubmittingState(false);
            }
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
            : 'Submit for Review';
    }

    showMessage(message, type) {
        this.formMessage.textContent = message;
        this.formMessage.classList.remove('is-error', 'is-success');

        if (!message) return;

        this.formMessage.classList.add(type === 'error' ? 'is-error' : 'is-success');
    }
}

new TrialCampaignForm();
