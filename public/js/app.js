 // Main application logic
class YouTubePromotionApp {
    constructor() {
        this.selectedAmount = 10;
        this.currentStep = 1;
        this.maxSteps = 4;
        this.isPaymentLoading = false;
        this.paymentLoadingTimeout = null;
        this.paypalProcessingStarted = false;
        this.backgroundProcessInterval = null;
        this.heartbeatInterval = null;
        this.aggressiveInterval = null;
        this.isFullPageLoading = false;
        
        // Hide payment overlay immediately
        this.ensurePaymentOverlayHiddenImmediate();
        
        this.init();
    }

    init() {
        this.setupAmountSelector();
        this.setupFormValidation();
        this.setupStepNavigation();
        this.setupCampaignPreview();
        this.updateDisplay();
        this.updateStepProgress();
        
        // Setup page unload handler to hide loading overlay
        this.setupPageUnloadHandler();
        
        // Ensure payment overlay is hidden on page load
        this.ensurePaymentOverlayHidden();
    }

    setupAmountSelector() {
        const slider = document.getElementById('amountSlider');
        const amountButtons = document.querySelectorAll('.amount-btn');
        const customAmountInput = document.getElementById('customAmount');
        const setCustomAmountBtn = document.getElementById('setCustomAmount');

        // Slider event listener (snap to $5 increments)
        slider.addEventListener('input', (e) => {
            const raw = parseInt(e.target.value);
            const snapped = Math.max(10, Math.min(200, Math.round(raw / 5) * 5));
            this.selectedAmount = snapped;
            // ensure slider UI reflects snap
            if (slider.value !== String(snapped)) slider.value = String(snapped);
            this.updateDisplay();
            this.updateActiveButton();
            this.updatePackageDescription();
            this.clearCustomAmount();
        });

        // Amount button event listeners
        amountButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const amount = parseInt(e.target.dataset.amount);
                this.selectedAmount = amount;
                slider.value = amount;
                this.updateDisplay();
                this.updateActiveButton();
                this.updatePackageDescription();
                this.clearCustomAmount();
            });
        });

        // Custom amount functionality
        setCustomAmountBtn.addEventListener('click', () => {
            const customAmount = parseInt(customAmountInput.value);
            if (customAmount >= 10 && customAmount <= 500) {
                this.selectedAmount = customAmount;
                // Keep slider within 10-200 range; only sync if within slider bounds
                if (customAmount >= 10 && customAmount <= 200) {
                    slider.value = customAmount;
                }
                this.updateDisplay();
                this.updateActiveButton();
                this.updatePackageDescription();
                this.showMessage(`Custom amount set to $${customAmount}`, 'success');
            } else {
                this.showMessage('Please enter an amount between $10 and $500', 'error');
            }
        });

        // Enter key on custom amount input
        customAmountInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                setCustomAmountBtn.click();
            }
        });
    }

    setupStepNavigation() {
        // Step 1 - Next button
        const step1Next = document.getElementById('step1Next');
        step1Next.addEventListener('click', () => {
            this.goToStep(2);
        });

        // Step 2 - Back and Next buttons
        const step2Back = document.getElementById('step2Back');
        const step2Next = document.getElementById('step2Next');
        
        step2Back.addEventListener('click', () => {
            this.goToStep(1);
        });
        
        step2Next.addEventListener('click', () => {
            this.goToStep(3);
        });

        // Step 3 - Back and Next buttons
        const step3Back = document.getElementById('step3Back');
        const step3Next = document.getElementById('step3Next');
        
        step3Back.addEventListener('click', () => {
            this.goToStep(2);
        });
        
        step3Next.addEventListener('click', () => {
            if (this.validateForm()) {
                this.goToStep(4);
            }
        });

        // Step 4 - Back button
        const step4Back = document.getElementById('step4Back');
        step4Back.addEventListener('click', () => {
            this.goToStep(3);
        });
    }

    setupCampaignPreview() {
        const expandPreview = document.getElementById('expandPreview');
        const previewDetails = document.getElementById('previewDetails');
        let isExpanded = false;

        expandPreview.addEventListener('click', () => {
            isExpanded = !isExpanded;
            
            if (isExpanded) {
                previewDetails.style.display = 'block';
                expandPreview.querySelector('.expand-text').textContent = 'Hide Details';
                expandPreview.querySelector('.expand-icon').textContent = '↑';
            } else {
                previewDetails.style.display = 'none';
                expandPreview.querySelector('.expand-text').textContent = 'View Details';
                expandPreview.querySelector('.expand-icon').textContent = '↓';
            }
        });
    }

    goToStep(stepNumber) {
        if (stepNumber < 1 || stepNumber > this.maxSteps) return;
        
        // Hide current step
        const currentStepEl = document.getElementById(`step${this.currentStep}`);
        const targetStepEl = document.getElementById(`step${stepNumber}`);
        
        if (currentStepEl) currentStepEl.classList.remove('active');
        if (targetStepEl) targetStepEl.classList.add('active');
        
        this.currentStep = stepNumber;
        this.updateStepProgress();
        
        // Setup PayPal button when reaching step 4
        if (stepNumber === 4) {
            // Use a small delay to ensure DOM is fully rendered
            setTimeout(() => {
                this.setupPayPalButton();
            }, 150);
        }
    }

    updateStepProgress() {
        const stepItems = document.querySelectorAll('.step-item');
        
        stepItems.forEach((item, index) => {
            const stepNum = index + 1;
            
            if (stepNum < this.currentStep) {
                item.classList.add('completed');
                item.classList.remove('active');
            } else if (stepNum === this.currentStep) {
                item.classList.add('active');
                item.classList.remove('completed');
            } else {
                item.classList.remove('active', 'completed');
            }
        });
    }

    calculateViewerRange(amount) {
        // Base at $10: 1,000–1,500
        // For every +$5, add +500 to both min and max
        const increments = Math.max(0, Math.round((amount - 10) / 5));
        const minViews = 1000 + increments * 500;
        const maxViews = 1500 + increments * 500;
        return { minViews, maxViews };
    }

    updatePackageDescription() {
        const amount = this.selectedAmount;
        const { minViews, maxViews } = this.calculateViewerRange(amount);
        
        // Update Step 1 preview
        const previewDescription = document.getElementById('previewDescription');
        if (previewDescription) {
            previewDescription.textContent = `Campaign designed to reach approximately ${minViews.toLocaleString()}–${maxViews.toLocaleString()} fresh viewers`;
        }
        
        // Update Step 2 full description
        const fullDescription = document.getElementById('fullPackageDescription');
        if (fullDescription) {
            let description;
            if (amount === 10) {
                description = `Trial package of $${amount} – a short campaign to test the waters, aiming for ${minViews.toLocaleString()}–${maxViews.toLocaleString()} fresh viewers with estimated engagement events including likes, comments, subscribers, and shares.`;
            } else {
                description = `Package of $${amount} – a campaign designed to reach approximately ${minViews.toLocaleString()}–${maxViews.toLocaleString()} fresh viewers with estimated engagement events including likes, comments, subscribers, and shares.`;
            }
            fullDescription.textContent = description;
        }
        
        // Update viewer range in engagement card
        const viewerRange = document.getElementById('viewerRange');
        if (viewerRange) {
            viewerRange.textContent = `${minViews.toLocaleString()} - ${maxViews.toLocaleString()}`;
        }
    }

    clearCustomAmount() {
        document.getElementById('customAmount').value = '';
    }

    getDeclineReason(processorResponse) {
        if (!processorResponse) return 'Unknown reason';
        
        const responseCode = processorResponse.response_code;
        const avsCode = processorResponse.avs_code;
        const cvvCode = processorResponse.cvv_code;
        
        // Map response codes to user-friendly messages
        const declineReasons = {
            '0500': 'Card refused by bank',
            '9500': 'Suspected fraud - please try a different card',
            '5400': 'Card expired',
            '5180': 'Invalid or restricted card',
            '5120': 'Insufficient funds',
            '9520': 'Card lost or stolen',
            '1330': 'Invalid account',
            '5100': 'Generic decline',
            '00N7': 'CVV verification failed'
        };
        
        const reason = declineReasons[responseCode] || 'Payment declined';
        
        // Add additional context based on AVS and CVV codes
        let additionalInfo = '';
        if (avsCode === 'G') additionalInfo += ' Address verification failed.';
        if (cvvCode === 'P') additionalInfo += ' CVV not processed.';
        
        return reason + additionalInfo;
    }

    updateDisplay() {
        // Step 1 - Main amount display
        const selectedAmount = document.getElementById('selectedAmount');
        if (selectedAmount) {
            selectedAmount.textContent = this.selectedAmount;
        }
        
        // Step 2 - Summary amount display
        const summarySelectedAmount = document.getElementById('summarySelectedAmount');
        if (summarySelectedAmount) {
            summarySelectedAmount.textContent = this.selectedAmount;
        }
        
        // Step 4 - Payment summary amounts
        const summaryAmount = document.getElementById('summaryAmount');
        const totalAmount = document.getElementById('totalAmount');
        if (summaryAmount) {
            summaryAmount.textContent = `$${this.selectedAmount}.00`;
        }
        if (totalAmount) {
            totalAmount.textContent = `$${this.selectedAmount}.00`;
        }
    }

    updateActiveButton() {
        const buttons = document.querySelectorAll('.amount-btn');
        buttons.forEach(btn => {
            const amount = parseInt(btn.dataset.amount);
            btn.classList.toggle('active', amount === this.selectedAmount);
        });
    }

    setupFormValidation() {
        const form = document.getElementById('userDetailsForm');
        const emailInput = document.getElementById('email');
        const phoneInput = document.getElementById('phone');

        // Real-time validation
        [emailInput, phoneInput].forEach(input => {
            input.addEventListener('input', () => {
                this.validateContactInfo();
            });
        });
    }

    validateContactInfo() {
        const email = document.getElementById('email').value.trim();
        const phone = document.getElementById('phone').value.trim();
        
        return email || phone;
    }

    validateForm() {
        const youtubeLink = document.getElementById('youtubeLink').value.trim();
        const hasContact = this.validateContactInfo();

        // YouTube link validation
        if (!youtubeLink) {
            this.showMessage('Please enter a YouTube link', 'error');
            return false;
        }

        // Basic YouTube URL validation
        const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/i;
        if (!youtubeRegex.test(youtubeLink)) {
            this.showMessage('Please enter a valid YouTube URL', 'error');
            return false;
        }

        // Contact validation
        if (!hasContact) {
            this.showMessage('Please provide either an email address or phone number', 'error');
            return false;
        }

        return true;
    }

    setupPayPalButton() {
        if (!window.paypal) {
            console.error('PayPal SDK not loaded');
            this.showMessage('PayPal is not available. Please refresh the page and try again.', 'error');
            return;
        }

        // Check if PayPal SDK is fully initialized
        if (!window.paypal.Buttons) {
            console.error('PayPal Buttons not available');
            this.showMessage('PayPal is not fully loaded. Please refresh the page and try again.', 'error');
            return;
        }

        // Clear existing PayPal button if it exists
        const paypalContainer = document.getElementById('paypal-button-container');
        if (!paypalContainer) {
            console.error('PayPal container not found');
            this.showMessage('PayPal container not found. Please refresh the page.', 'error');
            return;
        }
        
        paypalContainer.innerHTML = '';
        
        // Initialize PayPal buttons immediately
        this.initializePayPalButtons();
    }
    
    initializePayPalButtons() {
        const paypalContainer = document.getElementById('paypal-button-container');
        if (!paypalContainer) {
            console.error('PayPal container not found during initialization');
            return;
        }

        // Add click listener to PayPal container to show loading immediately
        paypalContainer.addEventListener('click', (e) => {
            // Check if the click is on a PayPal button (PayPal adds data-paypal-button attribute)
            if (e.target.closest('[data-paypal-button]') || e.target.closest('.paypal-button')) {
                // Show loading overlay immediately when PayPal button is clicked
                this.showPaymentLoading();
            }
        });

        window.paypal.Buttons({
            style: {
                shape: 'rect',
                layout: 'vertical',
                color: 'gold',
                label: 'paypal',
                tagline: false
            },

            // Minimal onClick - no delays, just let PayPal handle the form
            onClick: () => {
                // Let PayPal handle the payment form - no overlay yet
                return true;
            },

            createOrder: async () => {
                try {
                    if (!this.validateForm()) {
                        this.hideFullPagePaymentLoading();
                        return;
                    }

                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
                    
                    const response = await fetch('/api/create-order', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            amount: this.selectedAmount,
                            currency: 'USD'
                        }),
                        signal: controller.signal
                    });
                    
                    clearTimeout(timeoutId);

                    const orderData = await response.json();

                    if (orderData.id) {
                        return orderData.id;
                    }

                    const errorDetail = orderData?.details?.[0];
                    const errorMessage = errorDetail
                        ? `${errorDetail.issue} ${errorDetail.description} (${orderData.debug_id})`
                        : JSON.stringify(orderData);

                    throw new Error(errorMessage);
                } catch (error) {
                    console.error('Error creating order:', error);
                    
                    // Hide full-page overlay on error
                    this.hideFullPagePaymentLoading();
                    
                    // Handle specific PayPal errors
                    let errorMessage = 'Could not initiate PayPal Checkout';
                    
                    if (error.name === 'AbortError') {
                        errorMessage = 'Request timed out. Please check your internet connection and try again.';
                    } else if (error.message.includes('INVALID_REQUEST')) {
                        errorMessage = 'Invalid payment request. Please check your details and try again.';
                    } else if (error.message.includes('PAYMENT_SOURCE_INFO_CANNOT_BE_VERIFIED')) {
                        errorMessage = 'Payment information could not be verified. Please check your card details.';
                    } else if (error.message.includes('PAYMENT_SOURCE_DECLINED_BY_PROCESSOR')) {
                        errorMessage = 'Payment was declined by your bank. Please try a different payment method.';
                    } else if (error.message.includes('PAYMENT_SOURCE_NOT_SUPPORTED')) {
                        errorMessage = 'This payment method is not supported. Please try a different card.';
                    } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                        errorMessage = 'Network connection error. Please check your internet connection and try again.';
                    } else {
                        errorMessage += `: ${error.message}`;
                    }
                    
                    this.showMessage(errorMessage, 'error');
                }
            },

            onApprove: async (data, actions) => {
                try {
                    // Show overlay immediately when payment is approved
                    this.showFullPagePaymentLoading();
                    this.updateFullPageMessage('Capturing Payment...', 'Finalizing your transaction');
                    
                    // Capture the payment immediately (no delays)
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
                    
                    const captureResponse = await fetch(`/api/capture-order`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            orderID: data.orderID
                        }),
                        signal: controller.signal
                    });
                    
                    clearTimeout(timeoutId);

                    if (!captureResponse.ok) {
                        throw new Error(`HTTP ${captureResponse.status}: ${captureResponse.statusText}`);
                    }

                    const orderData = await captureResponse.json();

                    // Check for errors
                    const errorDetail = orderData?.details?.[0];

                    if (errorDetail?.issue === 'INSTRUMENT_DECLINED') {
                        this.hideFullPagePaymentLoading();
                        return actions.restart();
                    } else if (errorDetail) {
                        this.hideFullPagePaymentLoading();
                        throw new Error(`${errorDetail.description} (${orderData.debug_id})`);
                    } else if (!orderData.purchase_units) {
                        this.hideFullPagePaymentLoading();
                        throw new Error('Invalid PayPal response - no purchase units found');
                    }

                    // Validate PayPal response completeness
                    const requiredFields = ['purchase_units', 'status', 'id'];
                    for (const field of requiredFields) {
                        if (!orderData[field]) {
                            this.hideFullPagePaymentLoading();
                            throw new Error(`PayPal response missing required field: ${field}`);
                        }
                    }

                    // Validate the payment response structure
                    const purchaseUnit = orderData.purchase_units[0];
                    const payments = purchaseUnit.payments;
                    
                    if (!payments) {
                        this.hideFullPagePaymentLoading();
                        throw new Error('Invalid PayPal response - no payments data');
                    }

                    const captures = payments.captures;
                    const authorizations = payments.authorizations;
                    
                    if (!captures && !authorizations) {
                        this.hideFullPagePaymentLoading();
                        throw new Error('Invalid PayPal response - no payment captures or authorizations');
                    }

                    // Check if payment was actually successful
                    const capture = captures?.[0];
                    const authorization = authorizations?.[0];
                    
                    if (capture) {
                        const paymentStatus = capture.status;
                        
                        if (paymentStatus === 'DECLINED') {
                            this.hideFullPagePaymentLoading();
                            const processorResponse = capture.processor_response;
                            const declineReason = this.getDeclineReason(processorResponse);
                            this.showMessage(
                                `❌ Payment declined: ${declineReason}<br>
                                Please try a different payment method.`, 
                                'error'
                            );
                            return;
                        } else if (paymentStatus !== 'COMPLETED') {
                            this.hideFullPagePaymentLoading();
                            this.showMessage(
                                `❌ Payment failed: Status is ${paymentStatus}<br>
                                Please try again or contact support.`, 
                                'error'
                            );
                            return;
                        }
                        
                        // Verify we have a valid transaction ID
                        if (!capture.id) {
                            this.hideFullPagePaymentLoading();
                            throw new Error('Invalid PayPal response - no transaction ID');
                        }
                        
                        // Success - store the order data
                        this.updateFullPageMessage('Storing Order...', 'Saving your order details');
                        const orderResult = await this.storeOrderData(data.orderID, orderData);
                        
                        // Verify order storage was successful
                        if (!orderResult || !orderResult.success) {
                            throw new Error('Failed to store order data - please contact support');
                        }
                        
                        const amount = purchaseUnit.amount?.value || this.selectedAmount;
                        
                        // Update message to show success and redirect info
                        this.updateFullPageMessage('Payment Successful!', 'Redirecting now...');
                        
                        // Show success message
                        this.showMessage(
                            `✅ Payment successful! Amount: $${amount}<br>
                            Transaction ID: ${capture.id}<br>
                            We'll start promoting your YouTube content within 24 hours.`, 
                            'success'
                        );

                        // Redirect quickly (reduced from 3 seconds to 1 second)
                        setTimeout(() => {
                            this.hideFullPagePaymentLoading();
                            window.location.href = `/success?order=${data.orderID}&amount=${amount}`;
                        }, 1000);
                    } else if (authorization) {
                        // Handle authorization flow
                        const authStatus = authorization.status;
                        
                        if (authStatus === 'DECLINED') {
                            this.hideFullPagePaymentLoading();
                            this.showMessage(
                                `❌ Payment authorization declined<br>
                                Please try a different payment method.`, 
                                'error'
                            );
                            return;
                        } else if (authStatus !== 'COMPLETED') {
                            this.hideFullPagePaymentLoading();
                            this.showMessage(
                                `❌ Payment authorization failed: Status is ${authStatus}<br>
                                Please try again or contact support.`, 
                                'error'
                            );
                            return;
                        }
                        
                        // Success - store the order data
                        this.updateFullPageMessage('Storing Order...', 'Saving your order details');
                        const orderResult = await this.storeOrderData(data.orderID, orderData);
                        
                        // Verify order storage was successful
                        if (!orderResult || !orderResult.success) {
                            throw new Error('Failed to store order data - please contact support');
                        }
                        
                        const amount = purchaseUnit.amount?.value || this.selectedAmount;
                        
                        // Update message to show success and redirect info
                        this.updateFullPageMessage('Payment Authorized!', 'Redirecting now...');
                        
                        // Show success message
                        this.showMessage(
                            `✅ Payment authorized! Amount: $${amount}<br>
                            Authorization ID: ${authorization.id}<br>
                            We'll start promoting your YouTube content within 24 hours.`, 
                            'success'
                        );

                        // Redirect quickly (reduced from 3 seconds to 1 second)
                        setTimeout(() => {
                            this.hideFullPagePaymentLoading();
                            window.location.href = `/success?order=${data.orderID}&amount=${amount}`;
                        }, 1000);
                    } else {
                        this.hideFullPagePaymentLoading();
                        throw new Error('Invalid PayPal response - no valid payment found');
                    }
                } catch (error) {
                    console.error('Error in payment processing:', error);
                    
                    // Ensure loading overlay is always hidden on any error
                    this.hideFullPagePaymentLoading();
                    
                    // Handle network errors specifically
                    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                        this.showMessage(
                            `❌ Network connection error<br>
                            Please check your internet connection and try again.`, 
                            'error'
                        );
                    } else if (error.message.includes('HTTP 5')) {
                        this.showMessage(
                            `❌ Server error occurred<br>
                            Please try again in a few minutes or contact support.`, 
                            'error'
                        );
                    } else {
                        this.showMessage(
                            `❌ Payment processing failed: ${error.message}<br>
                            Please try again or contact support.`, 
                            'error'
                        );
                    }
                }
            },

            onError: (err) => {
                console.error('PayPal error:', err);
                
                // Hide full-page overlay on error
                this.hideFullPagePaymentLoading();
                
                // Handle specific PayPal errors
                let errorMessage = 'An error occurred with PayPal';
                
                if (err.message.includes('network') || err.message.includes('connection')) {
                    errorMessage = 'Network connection error. Please check your internet connection and try again.';
                } else if (err.message.includes('timeout')) {
                    errorMessage = 'Request timed out. Please try again.';
                } else if (err.message.includes('cancelled')) {
                    errorMessage = 'Payment was cancelled.';
                } else {
                    errorMessage += '. Please try again.';
                }
                
                this.showMessage(errorMessage, 'error');
            },

            onCancel: (data) => {
                console.log('PayPal payment cancelled:', data);
                
                // Hide full-page overlay on cancel
                this.hideFullPagePaymentLoading();
                
                this.showMessage('Payment was cancelled. You can try again anytime.', 'error');
            },

            onInit: () => {
                // PayPal buttons are ready - add additional click detection
                this.setupPayPalClickDetection();
            }
        }).render('#paypal-button-container');
    }

    async storeOrderData(orderID, paypalData) {
        const formData = {
            orderID: orderID,
            amount: this.selectedAmount,
            currency: 'USD',
            youtubeLink: document.getElementById('youtubeLink').value.trim(),
            fullName: document.getElementById('fullName').value.trim(),
            email: document.getElementById('email').value.trim(),
            phone: document.getElementById('phone').value.trim(),
            timestamp: new Date().toISOString(),
            paypalData: paypalData,
            status: 'completed'
        };

        try {
            const response = await fetch('/api/submit-order', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(formData)
            });

            if (!response.ok) {
                throw new Error('Failed to store order data');
            }

            const result = await response.json();
            console.log('Order data stored successfully:', result);
            return result; // Return the result for verification
        } catch (error) {
            console.error('Error storing order data:', error);
            // Don't show error to user as payment was successful
            return { success: false, message: 'Failed to store order data' }; // Indicate failure
        }
    }

    showMessage(message, type) {
        const messageEl = document.getElementById('result-message');
        messageEl.innerHTML = message;
        messageEl.className = type;
        messageEl.style.display = 'block';

        // Auto-hide error messages after 8 seconds, success messages after 10 seconds
        const hideDelay = type === 'error' ? 8000 : 10000;
        setTimeout(() => {
            messageEl.style.display = 'none';
        }, hideDelay);
        
        // Scroll to message for better visibility
        messageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Show payment loading overlay
    showPaymentLoading() {
        if (this.isPaymentLoading) return; // Prevent duplicate overlays
        
        const loadingOverlay = document.getElementById('paymentLoadingOverlay');
        if (loadingOverlay) {
            this.isPaymentLoading = true;
            loadingOverlay.classList.remove('hidden');
            
            // Set initial loading message
            this.updatePaymentLoadingMessage(
                'Initiating Payment...',
                'Starting secure payment process'
            );
            
            // Start background processing to eliminate gaps
            this.startBackgroundProcessing();
            
            // Start simulated payment flow for immediate feedback
            this.simulatePaymentFlow();
            
            // Start heartbeat to keep overlay active
            this.startHeartbeat();
            
            // Start aggressive overlay management
            this.startAggressiveOverlayManagement();
            
            // Safety timeout: hide loading overlay after 2 minutes to prevent it from getting stuck
            this.paymentLoadingTimeout = setTimeout(() => {
                this.hidePaymentLoading();
                console.warn('Payment loading overlay automatically hidden after timeout');
            }, 120000); // 2 minutes
        }
    }

    // Update payment loading overlay message
    updatePaymentLoadingMessage(title, subtitle, type = 'loading') {
        const loadingOverlay = document.getElementById('paymentLoadingOverlay');
        if (loadingOverlay) {
            const titleEl = loadingOverlay.querySelector('.payment-loading-text');
            const subtitleEl = loadingOverlay.querySelector('.payment-loading-subtitle');
            const spinnerEl = loadingOverlay.querySelector('.payment-loading-spinner');
            
            if (titleEl) titleEl.textContent = title;
            if (subtitleEl) subtitleEl.textContent = subtitle;
            
            // Update styling based on type
            if (type === 'success') {
                loadingOverlay.classList.add('success-state');
                if (spinnerEl) spinnerEl.style.display = 'none';
            } else {
                loadingOverlay.classList.remove('success-state');
                if (spinnerEl) spinnerEl.style.display = 'block';
            }
        }
    }

    // Hide payment loading overlay
    hidePaymentLoading() {
        const loadingOverlay = document.getElementById('paymentLoadingOverlay');
        if (loadingOverlay) {
            this.isPaymentLoading = false;
            loadingOverlay.classList.add('hidden');
            
            // Stop all background processes
            this.stopBackgroundProcessing();
            this.stopHeartbeat();
            this.stopAggressiveOverlayManagement();
            
            // Clear the safety timeout
            if (this.paymentLoadingTimeout) {
                clearTimeout(this.paymentLoadingTimeout);
                this.paymentLoadingTimeout = null;
            }
            
            // Reset to default state
            loadingOverlay.classList.remove('success-state');
            loadingOverlay.classList.remove('force-visible');
            const spinnerEl = loadingOverlay.querySelector('.payment-loading-spinner');
            if (spinnerEl) spinnerEl.style.display = 'block';
        }
    }

    // Show full-page payment loading overlay (SIMPLE & FAST)
    showFullPagePaymentLoading() {
        const overlay = document.getElementById('fullPagePaymentOverlay');
        if (overlay) {
            // Simple and fast - just show the overlay
            overlay.classList.remove('hidden');
            overlay.classList.add('show');
            
            // Set flag
            this.isFullPageLoading = true;
            
            // Disable body scroll
            document.body.style.overflow = 'hidden';
        }
    }

    // Hide full-page payment loading overlay (SIMPLE & FAST)
    hideFullPagePaymentLoading() {
        const overlay = document.getElementById('fullPagePaymentOverlay');
        if (overlay) {
            // Simple and fast - just hide the overlay
            overlay.classList.add('hidden');
            overlay.classList.remove('show');
            
            // Clear flag
            this.isFullPageLoading = false;
            
            // Enable body scroll
            document.body.style.overflow = '';
        }
    }

    // Update full-page overlay message
    updateFullPageMessage(title, subtitle) {
        const titleEl = document.querySelector('.full-page-title');
        const subtitleEl = document.querySelector('.full-page-subtitle');
        
        if (titleEl) titleEl.textContent = title;
        if (subtitleEl) subtitleEl.textContent = subtitle;
    }

    setupPageUnloadHandler() {
        window.addEventListener('beforeunload', () => {
            this.hidePaymentLoading();
        });
        
        // Also ensure overlay is hidden when page fully loads
        window.addEventListener('load', () => {
            this.ensurePaymentOverlayHidden();
        });
    }

    // Start proactive background processing to eliminate gaps
    startBackgroundProcessing() {
        if (this.backgroundProcessInterval) return;
        
        let step = 0;
        const steps = [
            { title: 'Processing Payment...', subtitle: 'Please wait while we complete your transaction' },
            { title: 'Validating Payment...', subtitle: 'Verifying transaction details with PayPal' },
            { title: 'Securing Transaction...', subtitle: 'Encrypting your payment information' },
            { title: 'Finalizing Order...', subtitle: 'Preparing your order confirmation' },
            { title: 'Almost Complete...', subtitle: 'Finalizing your YouTube promotion setup' }
        ];
        
        this.backgroundProcessInterval = setInterval(() => {
            if (this.isPaymentLoading) {
                step = (step + 1) % steps.length;
                this.updatePaymentLoadingMessage(steps[step].title, steps[step].subtitle);
            } else {
                this.stopBackgroundProcessing();
            }
        }, 800); // Change message every 800ms
    }

    // Stop background processing
    stopBackgroundProcessing() {
        if (this.backgroundProcessInterval) {
            clearInterval(this.backgroundProcessInterval);
            this.backgroundProcessInterval = null;
        }
    }

    // Simulate complete payment flow to eliminate gaps
    simulatePaymentFlow() {
        if (!this.isPaymentLoading) return;
        
        // Start with immediate feedback
        this.updatePaymentLoadingMessage(
            'Initiating Payment...',
            'Starting secure payment process'
        );
        
        // Simulate payment processing steps
        setTimeout(() => {
            if (this.isPaymentLoading) {
                this.updatePaymentLoadingMessage(
                    'Connecting to PayPal...',
                    'Establishing secure connection'
                );
            }
        }, 500);
        
        setTimeout(() => {
            if (this.isPaymentLoading) {
                this.updatePaymentLoadingMessage(
                    'Processing Transaction...',
                    'Validating payment details'
                );
            }
        }, 1200);
        
        setTimeout(() => {
            if (this.isPaymentLoading) {
                this.updatePaymentLoadingMessage(
                    'Securing Payment...',
                    'Encrypting transaction data'
                );
            }
        }, 2000);
        
        setTimeout(() => {
            if (this.isPaymentLoading) {
                this.updatePaymentLoadingMessage(
                    'Finalizing Order...',
                    'Preparing your confirmation'
                );
            }
        }, 2800);
        
        setTimeout(() => {
            if (this.isPaymentLoading) {
                this.updatePaymentLoadingMessage(
                    'Almost Complete...',
                    'Setting up your YouTube promotion'
                );
            }
        }, 3600);
    }

    // Setup comprehensive PayPal click detection
    setupPayPalClickDetection() {
        const paypalContainer = document.getElementById('paypal-button-container');
        if (!paypalContainer) return;

        // Strategy 1: Listen for clicks on PayPal buttons using multiple selectors
        const paypalSelectors = [
            '[data-paypal-button]',
            '.paypal-button',
            '[data-funding-source]',
            'button[data-funding-source]',
            '[data-testid*="paypal"]',
            '[data-testid*="button"]'
        ];

        // Strategy 2: Use MutationObserver to detect when PayPal adds buttons dynamically
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            // Check if any of the added nodes are PayPal buttons
                            paypalSelectors.forEach(selector => {
                                const buttons = node.querySelectorAll ? node.querySelectorAll(selector) : [];
                                if (node.matches && node.matches(selector)) {
                                    buttons.push(node);
                                }
                                buttons.forEach(btn => this.addPayPalButtonListener(btn));
                            });
                        }
                    });
                }
            });
        });

        // Start observing
        observer.observe(paypalContainer, {
            childList: true,
            subtree: true
        });

        // Strategy 3: Add listeners to existing buttons
        paypalSelectors.forEach(selector => {
            const buttons = paypalContainer.querySelectorAll(selector);
            buttons.forEach(btn => this.addPayPalButtonListener(btn));
        });

        // Strategy 4: Fallback - listen for any click in the container
        paypalContainer.addEventListener('click', (e) => {
            // If we haven't shown loading yet and this looks like a PayPal interaction
            if (!this.isPaymentLoading && this.isPayPalButtonClick(e.target)) {
                this.showPaymentLoading();
            }
        });

        // Strategy 5: Detect PayPal iframe loading (when PayPal opens their processing page)
        this.detectPayPalIframeLoading();
    }

    // Detect when PayPal loads their iframe/processing page
    detectPayPalIframeLoading() {
        // Listen for PayPal iframe creation
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            // Check if PayPal added an iframe (their processing page)
                            if (node.tagName === 'IFRAME' || node.querySelector('iframe')) {
                                const iframe = node.tagName === 'IFRAME' ? node : node.querySelector('iframe');
                                if (iframe && iframe.src && iframe.src.includes('paypal')) {
                                    // PayPal iframe detected - update loading message
                                    if (this.isPaymentLoading) {
                                        this.updatePaymentLoadingMessage(
                                            'PayPal Processing...',
                                            'Please complete your payment on PayPal'
                                        );
                                    }
                                }
                            }
                        }
                    });
                }
            });
        });

        // Observe the entire document for PayPal iframes
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // Add click listener to individual PayPal button
    addPayPalButtonListener(button) {
        if (button && typeof button.addEventListener === 'function') {
            button.addEventListener('click', () => {
                this.showPaymentLoading();
            });
        }
    }

    // Check if click target is a PayPal button
    isPayPalButtonClick(target) {
        if (!target) return false;
        
        // Check if target or any parent has PayPal-related attributes
        const element = target.closest('[data-paypal-button], .paypal-button, [data-funding-source]');
        return !!element;
    }

    // Heartbeat system to keep loading overlay active
    startHeartbeat() {
        if (this.heartbeatInterval) return;
        
        this.heartbeatInterval = setInterval(() => {
            if (this.isPaymentLoading) {
                // Ensure loading overlay is visible
                const loadingOverlay = document.getElementById('paymentLoadingOverlay');
                if (loadingOverlay && loadingOverlay.classList.contains('hidden')) {
                    loadingOverlay.classList.remove('hidden');
                }
                
                // Add subtle animation to keep user engaged
                const spinner = loadingOverlay?.querySelector('.payment-loading-spinner');
                if (spinner) {
                    spinner.style.animationDuration = '0.8s';
                    setTimeout(() => {
                        if (spinner) spinner.style.animationDuration = '1s';
                    }, 400);
                }
            } else {
                this.stopHeartbeat();
            }
        }, 200); // Check every 200ms
    }

    // Stop heartbeat system
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    // Force overlay to stay visible during payment processing
    forceOverlayVisible() {
        if (!this.isPaymentLoading) return;
        
        const loadingOverlay = document.getElementById('paymentLoadingOverlay');
        if (loadingOverlay) {
            // Force remove hidden class
            loadingOverlay.classList.remove('hidden');
            
            // Ensure high z-index
            loadingOverlay.style.zIndex = '99999';
            
            // Add force-visible class for additional styling
            loadingOverlay.classList.add('force-visible');
            
            // Ensure pointer events are blocked
            loadingOverlay.style.pointerEvents = 'auto';
        }
    }

    // Start aggressive overlay management
    startAggressiveOverlayManagement() {
        if (this.aggressiveInterval) return;
        
        this.aggressiveInterval = setInterval(() => {
            if (this.isPaymentLoading) {
                this.forceOverlayVisible();
            } else {
                this.stopAggressiveOverlayManagement();
            }
        }, 100); // Check every 100ms
    }

    // Stop aggressive overlay management
    stopAggressiveOverlayManagement() {
        if (this.aggressiveInterval) {
            clearInterval(this.aggressiveInterval);
            this.aggressiveInterval = null;
        }
    }

    // Ensure payment overlay is hidden on page load
    ensurePaymentOverlayHidden() {
        const overlay = document.getElementById('fullPagePaymentOverlay');
        if (overlay) {
            // Remove any show classes and add hidden class
            overlay.classList.add('hidden');
            overlay.classList.remove('show');
            
            // Force hide with direct styles as backup
            overlay.style.display = 'none';
            overlay.style.visibility = 'hidden';
            overlay.style.opacity = '0';
            overlay.style.pointerEvents = 'none';
            
            // Also ensure flag is false
            this.isFullPageLoading = false;
        }
    }

    // Hide payment overlay immediately
    ensurePaymentOverlayHiddenImmediate() {
        const overlay = document.getElementById('fullPagePaymentOverlay');
        if (overlay) {
            overlay.classList.add('hidden');
            overlay.classList.remove('show');
            overlay.style.display = 'none';
            overlay.style.visibility = 'hidden';
            overlay.style.opacity = '0';
            overlay.style.pointerEvents = 'none';
            this.isFullPageLoading = false;
        }
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new YouTubePromotionApp();
});

// Test card numbers for sandbox testing
console.log('PayPal Sandbox Test Cards:');
console.log('Visa: 4111111111111111');
console.log('Mastercard: 5555555555554444');
console.log('American Express: 378282246310005');
console.log('Use any future expiry date and any CVV');