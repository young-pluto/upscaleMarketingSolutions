class LeadOutreachSubmissionForm {
    constructor() {
        this.activeTab = 'lead';
        this.setupTabs();
        this.setupForms();
    }

    setupTabs() {
        document.querySelectorAll('[data-form-tab]').forEach((button) => {
            button.addEventListener('click', () => {
                this.activeTab = button.dataset.formTab;
                document.querySelectorAll('[data-form-tab]').forEach((tab) => {
                    tab.classList.toggle('active', tab.dataset.formTab === this.activeTab);
                });
                document.getElementById('leadFormPanel').classList.toggle('active', this.activeTab === 'lead');
                document.getElementById('pageFormPanel').classList.toggle('active', this.activeTab === 'page');
            });
        });
    }

    setupForms() {
        document.getElementById('leadSubmissionForm').addEventListener('submit', (event) => this.submitLead(event));
        document.getElementById('pageSubmissionForm').addEventListener('submit', (event) => this.submitPage(event));
    }

    async submitLead(event) {
        event.preventDefault();

        const form = event.currentTarget;
        const button = document.getElementById('leadSubmitBtn');
        const message = document.getElementById('leadFormMessage');
        const payload = {
            type: 'lead',
            instagramLink: document.getElementById('instagramLink').value.trim(),
            youtubeLink: document.getElementById('youtubeLink').value.trim()
        };

        await this.submitPayload(payload, form, button, message, 'Client submitted.');
    }

    async submitPage(event) {
        event.preventDefault();

        const form = event.currentTarget;
        const button = document.getElementById('pageSubmitBtn');
        const message = document.getElementById('pageFormMessage');
        const payload = {
            type: 'page',
            instagramUrl: document.getElementById('pageInstagramLink').value.trim()
        };

        await this.submitPayload(payload, form, button, message, 'Page submitted.');
    }

    async submitPayload(payload, form, button, message, successMessage) {
        this.setMessage(message, 'Submitting...', 'success');
        this.setButtonBusy(button, true);

        try {
            const response = await fetch('/api/submit-lead-outreach', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.message || result.error || 'Could not submit this form.');
            }

            form.reset();
            this.setMessage(message, successMessage, 'success');
        } catch (error) {
            console.error('Lead outreach submission failed:', error);
            this.setMessage(message, error.message || 'Submission failed. Please try again.', 'error');
        } finally {
            this.setButtonBusy(button, false);
        }
    }

    setButtonBusy(button, isBusy) {
        if (isBusy) {
            button.dataset.originalText = button.textContent;
            button.textContent = 'Submitting...';
            button.disabled = true;
            return;
        }

        button.textContent = button.dataset.originalText || button.textContent;
        button.disabled = false;
    }

    setMessage(element, message, type) {
        element.textContent = message;
        element.classList.remove('error', 'success');
        if (type) element.classList.add(type);
    }
}

new LeadOutreachSubmissionForm();
