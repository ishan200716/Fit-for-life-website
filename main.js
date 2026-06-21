/* ==========================================================================
   FIT FOR LIFE - Premium Cinematic Scrollytelling Script
   ========================================================================== */

(function () {
    // --- Elements ---
    const canvas = document.getElementById('bg-canvas');
    const ctx = canvas.getContext('2d');
    const scrollWrapper = document.getElementById('scroll-wrapper');
    const loaderScreen = document.getElementById('loader-screen');
    const loaderProgressText = document.querySelector('.loader-progress');

    // --- Configuration & State ---
    let isDesktop = window.innerWidth >= 1024;
    let folder = '';
    let totalFrames = 0;

    // Prefetching queue state
    let imageCache = [];
    const loadingIndices = new Set();
    const MAX_CONCURRENT_LOADS = 6;
    let activeLoads = 0;
    let initialPrefetchComplete = false;
    const INITIAL_PREFETCH_COUNT = 40; // Load first 40 frames to unlock screen

    // Scroll scrubbing state
    let targetFraction = 0;
    let currentFraction = 0;
    let lastTargetFraction = 0;
    let scrollVelocity = 0;
    let lastDrawnIndex = -1;

    // LERP config
    const LERP_EASE = 0.12;
    const SNAP_THRESHOLD = 0.001;
    let scrollytellingRange = window.innerHeight * 8;

    // Scroll Lock State (for 2s pause on the last frame)
    let scrollLockActive = false;
    let scrollLockCompleted = false;
    let scrollLockTimer = null;
    let isLockingScroll = false;
    let touchStartY = 0;

    // --- Media Sequence Configurator ---
    function initSequence() {
        // Stop any active loading
        loadingIndices.clear();
        activeLoads = 0;

        // Reset device state
        isDesktop = window.innerWidth >= 1024;

        if (isDesktop) {
            folder = 'source-pc';
            totalFrames = 236; // frame_000 to frame_235
        } else {
            folder = 'source-phone';
            totalFrames = 201; // frame_000 to frame_200
        }

        // Initialize cache arrays
        imageCache = new Array(totalFrames);
        lastDrawnIndex = -1;
        initialPrefetchComplete = false;

        // Reset target fractions to current scroll
        updateTargetScroll();
        currentFraction = targetFraction;

        // Show loader if we are switching or starting
        if (loaderScreen.classList.contains('fade-out')) {
            loaderScreen.classList.remove('fade-out');
            loaderScreen.style.display = 'flex';
        }

        // Start loading
        pumpPrefetchQueue();
    }

    // --- File URL Builder ---
    function getFrameUrl(index) {
        const paddedIndex = String(index).padStart(3, '0');
        return `${folder}/frame_${paddedIndex}_delay-0.05s.webp`;
    }

    // --- Priority Prefetching Queue ---
    function getFramePriorityList() {
        const list = [];
        const currentTargetIdx = Math.round(targetFraction * (totalFrames - 1));
        const direction = scrollVelocity >= 0 ? 1 : -1;

        for (let i = 0; i < totalFrames; i++) {
            // Skip already loaded
            if (imageCache[i] && imageCache[i].complete && imageCache[i].naturalWidth > 0) {
                continue;
            }
            // Skip currently loading
            if (loadingIndices.has(i)) {
                continue;
            }

            // Distance from current scroll target
            const dist = Math.abs(i - currentTargetIdx);

            // Determine direction weight (prioritize frames in direction of scroll)
            let dirWeight = 1.0;
            if (direction > 0 && i > currentTargetIdx) {
                dirWeight = 0.4; // high priority (lower score)
            } else if (direction < 0 && i < currentTargetIdx) {
                dirWeight = 0.4; // high priority
            } else if (i === currentTargetIdx) {
                dirWeight = 0.1; // absolute highest priority
            } else {
                dirWeight = 1.5; // low priority (frames behind)
            }

            // Score: smaller means higher loading priority
            const score = dist * dirWeight;
            list.push({ index: i, score: score });
        }

        // Sort by priority score (ascending)
        list.sort((a, b) => a.score - b.score);
        return list.map(item => item.index);
    }

    function pumpPrefetchQueue() {
        if (activeLoads >= MAX_CONCURRENT_LOADS) return;

        const priorityIndices = getFramePriorityList();
        if (priorityIndices.length === 0) return;

        const startCount = Math.min(MAX_CONCURRENT_LOADS - activeLoads, priorityIndices.length);
        for (let i = 0; i < startCount; i++) {
            const idx = priorityIndices[i];
            startLoadingFrame(idx);
        }
    }

    function startLoadingFrame(index) {
        activeLoads++;
        loadingIndices.add(index);

        const img = new Image();
        img.onload = () => {
            imageCache[index] = img;
            activeLoads--;
            loadingIndices.delete(index);

            checkInitialPrefetch();
            updateLoaderProgress();

            // Draw immediately if this is the target frame to prevent blank flashes
            const currentTargetIdx = Math.round(currentFraction * (totalFrames - 1));
            if (index === currentTargetIdx) {
                drawCurrentFrame();
            }

            pumpPrefetchQueue();
        };
        img.onerror = () => {
            activeLoads--;
            loadingIndices.delete(index);
            pumpPrefetchQueue(); // Proceed to next
        };
        img.src = getFrameUrl(index);
    }

    // --- Loader Tracker ---
    function checkInitialPrefetch() {
        if (initialPrefetchComplete) return;

        // Check if the first INITIAL_PREFETCH_COUNT frames are loaded
        let loadedRequiredCount = 0;
        const requiredCount = Math.min(INITIAL_PREFETCH_COUNT, totalFrames);

        for (let i = 0; i < requiredCount; i++) {
            if (imageCache[i] && imageCache[i].complete && imageCache[i].naturalWidth > 0) {
                loadedRequiredCount++;
            }
        }

        if (loadedRequiredCount >= requiredCount) {
            initialPrefetchComplete = true;
            hideLoader();
        }
    }

    function updateLoaderProgress() {
        if (initialPrefetchComplete) return;

        let loadedRequiredCount = 0;
        const requiredCount = Math.min(INITIAL_PREFETCH_COUNT, totalFrames);

        for (let i = 0; i < requiredCount; i++) {
            if (imageCache[i] && imageCache[i].complete && imageCache[i].naturalWidth > 0) {
                loadedRequiredCount++;
            }
        }

        const percentage = Math.min(100, Math.round((loadedRequiredCount / requiredCount) * 100));
        loaderProgressText.textContent = `${percentage}%`;
        loaderScreen.setAttribute('aria-valuenow', percentage);
    }

    function hideLoader() {
        loaderScreen.classList.add('fade-out');
        setTimeout(() => {
            loaderScreen.style.display = 'none';
        }, 800); // match CSS transitions
    }

    // --- Scroll Handler ---
    function updateTargetScroll() {
        if (isLockingScroll) return;

        let scrollTop = scrollWrapper.scrollTop;

        // Check if we reached or exceeded the end of the video sequence
        if (scrollTop >= scrollytellingRange) {
            if (!scrollLockCompleted) {
                // Ensure final frame is fully drawn before lock
                if (!scrollLockActive && lastDrawnIndex === totalFrames - 1) {
                    scrollLockActive = true;
                    // Start the 0.2-second lock
                    scrollLockTimer = setTimeout(() => {
                        scrollLockActive = false;
                        scrollLockCompleted = true;
                    }, 200);
                }

                // Snap scroll position to scrollytellingRange to prevent overscroll
                isLockingScroll = true;
                scrollWrapper.scrollTop = scrollytellingRange;
                scrollTop = scrollytellingRange;
                isLockingScroll = false;
            }
        } else if (scrollTop < scrollytellingRange - 50) {
            // Reset lock state if we scroll back up significantly
            if (scrollLockTimer) {
                clearTimeout(scrollLockTimer);
                scrollLockTimer = null;
            }
            scrollLockActive = false;
            scrollLockCompleted = false;
        }

        // Scrub only within the scrolling range of the canvas sequence (first 800vh)
        targetFraction = scrollytellingRange > 0 ? Math.min(1, scrollTop / scrollytellingRange) : 0;

        // Calculate velocity and track direction
        scrollVelocity = targetFraction - lastTargetFraction;
        lastTargetFraction = targetFraction;

        // Trigger queue pump on scroll events to prioritize nearby frames
        pumpPrefetchQueue();

        // Update fixed overlay text visibility & styling
        updateTextOverlays(scrollTop);

        // Update header background when scrolling down
        updateHeader(scrollTop);
    }

    // --- Layout Aspect Cover Canvas Renderer ---
    function drawCurrentFrame() {
        const frameIdx = Math.round(currentFraction * (totalFrames - 1));
        const img = imageCache[frameIdx];

        if (!img || !img.complete || img.naturalWidth === 0) {
            // If targeted frame isn't loaded yet, try finding the nearest loaded fallback frame
            let fallbackImg = null;
            let minDiff = Infinity;

            for (let i = 0; i < totalFrames; i++) {
                if (imageCache[i] && imageCache[i].complete && imageCache[i].naturalWidth > 0) {
                    const diff = Math.abs(i - frameIdx);
                    if (diff < minDiff) {
                        minDiff = diff;
                        fallbackImg = imageCache[i];
                    }
                }
            }

            if (fallbackImg) {
                drawCover(fallbackImg);
            }
            return;
        }

        // Optimize: avoid drawing if this index has already been rendered in the last frame
        if (frameIdx === lastDrawnIndex) return;

        drawCover(img);
        lastDrawnIndex = frameIdx;
    }

    function drawCover(img) {
        const canvasWidth = canvas.width;
        const canvasHeight = canvas.height;
        const imgWidth = img.naturalWidth;
        const imgHeight = img.naturalHeight;

        const canvasRatio = canvasWidth / canvasHeight;
        const imgRatio = imgWidth / imgHeight;

        let drawWidth, drawHeight, offsetX, offsetY;

        if (canvasRatio > imgRatio) {
            // Canvas is wider than image aspect ratio
            drawWidth = canvasWidth;
            drawHeight = canvasWidth / imgRatio;
            offsetX = 0;
            offsetY = (canvasHeight - drawHeight) / 2;
        } else {
            // Canvas is taller than image aspect ratio
            drawWidth = canvasHeight * imgRatio;
            drawHeight = canvasHeight;
            offsetX = (canvasWidth - drawWidth) / 2;
            offsetY = 0;
        }

        // Opaque frames: draw directly covering the viewport (skipping clearRect for performance)
        ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
    }

    // --- Smooth LERP Game Loop ---
    function renderLoop() {
        const diff = targetFraction - currentFraction;

        if (Math.abs(diff) < SNAP_THRESHOLD) {
            currentFraction = targetFraction;
        } else {
            currentFraction += diff * LERP_EASE;
        }

        drawCurrentFrame();
        // If scroll is at end range and final frame drawn, start lock if not already active/completed
        if (scrollWrapper.scrollTop >= scrollytellingRange && !scrollLockActive && !scrollLockCompleted && lastDrawnIndex === totalFrames - 1) {
            scrollLockActive = true;
            // Start the 0.2-second lock
            scrollLockTimer = setTimeout(() => {
                scrollLockActive = false;
                scrollLockCompleted = true;
            }, 200);
        }
        requestAnimationFrame(renderLoop);
    }

    // --- Layout Resize Handler ---
    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        // Recalculate scrolling range for video frames
        scrollytellingRange = window.innerHeight * 8;

        // Handle desktop/mobile layout switch dynamically
        const currentIsDesktop = window.innerWidth >= 1024;
        if (currentIsDesktop !== isDesktop) {
            initSequence();
        } else {
            drawCurrentFrame();
        }
    }

    // --- Initialization & Listeners ---
    // Start media sequence
    initSequence();

    // Set initial size
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // Listeners
    scrollWrapper.addEventListener('scroll', updateTargetScroll, { passive: true });
    window.addEventListener('resize', resizeCanvas, { passive: true });

    // Prevent scroll-down inputs when scroll lock is active
    scrollWrapper.addEventListener('wheel', e => {
        if (scrollLockActive && e.deltaY > 0) {
            e.preventDefault();
        }
    }, { passive: false });

    scrollWrapper.addEventListener('touchstart', e => {
        if (e.touches && e.touches.length > 0) {
            touchStartY = e.touches[0].clientY;
        }
    }, { passive: true });

    scrollWrapper.addEventListener('touchmove', e => {
        if (scrollLockActive && e.touches && e.touches.length > 0) {
            const touchCurrentY = e.touches[0].clientY;
            const touchDeltaY = touchStartY - touchCurrentY; // Positive for scrolling down
            if (touchDeltaY > 0) {
                e.preventDefault();
            }
        }
    }, { passive: false });

    scrollWrapper.addEventListener('keydown', e => {
        if (scrollLockActive) {
            const downKeys = ['ArrowDown', 'PageDown', ' '];
            if (downKeys.includes(e.key)) {
                e.preventDefault();
            }
        }
    }, { passive: false });

    // Start render loop
    requestAnimationFrame(renderLoop);

    // --- Scrollytelling Text Overlay Management ---
    function updateTextOverlays(scrollTop) {
        const overlayContainer = document.getElementById('text-overlay-container');
        if (!overlayContainer) return;

        // Dynamic fade out for scroll down prompt
        const scrollHint = document.getElementById('scroll-hint');
        if (scrollHint) {
            const hintOpacity = Math.max(0, 1 - (scrollTop / 150));
            scrollHint.style.opacity = hintOpacity.toFixed(3);
            scrollHint.style.transform = `translate(-50%, ${(1 - hintOpacity) * 15}px)`;
            scrollHint.style.visibility = hintOpacity > 0.01 ? 'visible' : 'hidden';
        }

        // Hide overlay container completely once scrolled past the spacer
        if (scrollTop >= scrollytellingRange) {
            overlayContainer.style.opacity = '0';
            overlayContainer.style.visibility = 'hidden';
            return;
        } else {
            overlayContainer.style.opacity = '1';
            overlayContainer.style.visibility = 'visible';
        }

        const fraction = scrollTop / scrollytellingRange;
        const config = [
            { id: 'overlay-1', start: 0.0, peak: 0.1, end: 0.22 },
            { id: 'overlay-2', start: 0.22, peak: 0.35, end: 0.48 },
            { id: 'overlay-3', start: 0.48, peak: 0.6, end: 0.72 },
            { id: 'overlay-4', start: 0.72, peak: 0.85, end: 0.98 }
        ];

        config.forEach(item => {
            const el = document.getElementById(item.id);
            if (!el) return;

            let opacity = 0;
            let translateOffset = 0;

            if (fraction >= item.start && fraction <= item.end) {
                if (fraction < item.peak) {
                    opacity = (fraction - item.start) / (item.peak - item.start);
                    translateOffset = (1 - opacity) * 15;
                } else {
                    opacity = 1 - (fraction - item.peak) / (item.end - item.peak);
                    translateOffset = -(1 - opacity) * 15;
                }
            }

            el.style.opacity = opacity.toFixed(3);
            el.style.transform = `translate(-50%, calc(-50% + ${translateOffset}px))`;
            el.style.visibility = opacity > 0.01 ? 'visible' : 'hidden';
        });
    }

    // --- Header Style Scroll Handler ---
    function updateHeader(scrollTop) {
        const header = document.getElementById('main-header');
        if (!header) return;

        if (scrollTop > 50) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }
    }

    // --- Navigation & Anchor Smooth Scroll ---
    const mobileNavToggle = document.querySelector('.mobile-nav-toggle');
    const navLinks = document.querySelector('.nav-links');

    if (mobileNavToggle && navLinks) {
        mobileNavToggle.addEventListener('click', () => {
            const isOpen = navLinks.classList.toggle('open');
            mobileNavToggle.classList.toggle('open');
            mobileNavToggle.setAttribute('aria-expanded', isOpen);
        });
    }

    document.querySelectorAll('.nav-links a, .nav-cta, .logo').forEach(link => {
        link.addEventListener('click', e => {
            const targetId = link.getAttribute('href');
            if (!targetId || targetId === '#' || targetId.startsWith('javascript:')) return;

            const targetSection = document.getElementById(targetId.substring(1));
            if (!targetSection) return;

            e.preventDefault();

            // Bypass and release the scroll lock since user explicitly navigated to a section
            if (scrollLockTimer) {
                clearTimeout(scrollLockTimer);
                scrollLockTimer = null;
            }
            scrollLockActive = false;
            scrollLockCompleted = true;

            // Close mobile menu if open
            if (navLinks) navLinks.classList.remove('open');
            if (mobileNavToggle) mobileNavToggle.classList.remove('open');

            const targetScrollTop = targetSection.getBoundingClientRect().top + scrollWrapper.scrollTop;
            scrollWrapper.scrollTo({
                top: targetScrollTop,
                behavior: 'smooth'
            });
        });
    });



    // --- BMI Calculator Logic ---
    const bmiForm = document.getElementById('bmi-form');
    const bmiPlaceholder = document.getElementById('bmi-placeholder');
    const bmiResultDisplay = document.getElementById('bmi-result-display');
    const bmiValue = document.getElementById('bmi-value');
    const bmiStatus = document.getElementById('bmi-status');
    const bmiBar = document.getElementById('bmi-bar');
    const bmiRecommendation = document.getElementById('bmi-recommendation');

    if (bmiForm) {
        bmiForm.addEventListener('submit', (e) => {
            e.preventDefault();

            const weightInput = document.getElementById('bmi-weight');
            const heightInput = document.getElementById('bmi-height');

            if (!weightInput || !heightInput) return;

            const weight = parseFloat(weightInput.value);
            const height = parseFloat(heightInput.value) / 100; // convert to meters

            if (weight > 0 && height > 0) {
                const bmi = weight / (height * height);
                const score = bmi.toFixed(1);

                // Update UI display
                if (bmiPlaceholder) bmiPlaceholder.classList.add('hidden');
                if (bmiResultDisplay) bmiResultDisplay.classList.remove('hidden');
                if (bmiValue) bmiValue.textContent = score;

                // Determine classification and advice
                let status = '';
                let percent = 0;
                let recommendation = '';

                if (bmi < 18.5) {
                    status = 'Underweight';
                    percent = 25;
                    recommendation = 'We recommend combining our Strength & Conditioning program with a high-protein nutritional plan to build healthy lean muscle mass.';
                } else if (bmi >= 18.5 && bmi < 25) {
                    status = 'Normal Weight';
                    percent = 50;
                    recommendation = 'Excellent physical standing. We suggest keeping active with our Strength & Conditioning routines and HIIT Cardio sessions to sustain body composition.';
                } else if (bmi >= 25 && bmi < 30) {
                    status = 'Overweight';
                    percent = 75;
                    recommendation = 'We recommend engaging in our High-Intensity Cardio (HIIT) and personal coaching to elevate daily caloric output and boost metabolic conditioning.';
                } else {
                    status = 'Obese';
                    percent = 95;
                    recommendation = 'We suggest a structured track combining specialized Personal Coaching with HIIT Cardio and Mobility classes to build a safe, sustainable fat-loss journey.';
                }

                if (bmiStatus) bmiStatus.textContent = status;

                // Trigger bar fill animation
                if (bmiBar) {
                    bmiBar.style.width = '0%';
                    setTimeout(() => {
                        bmiBar.style.width = `${percent}%`;
                    }, 100);
                }

                if (bmiRecommendation) bmiRecommendation.textContent = recommendation;
            }
        });
    }

    // --- Contact Form Submission (FormSubmit Integration) ---
    const contactForm = document.getElementById('contact-form');
    const contactSuccess = document.getElementById('contact-success');

    if (contactForm && contactSuccess) {
        contactForm.addEventListener('submit', (e) => {
            e.preventDefault();

            const submitBtn = contactForm.querySelector('button[type="submit"]');
            const originalText = submitBtn.textContent;
            submitBtn.textContent = 'SENDING...';
            submitBtn.disabled = true;

            const formData = new FormData(contactForm);

            fetch('https://formsubmit.co/ajax/fitforlifegym2020@gmail.com', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(Object.fromEntries(formData))
            })
            .then(response => {
                if (response.ok) {
                    // Fade form and show success message
                    contactForm.style.opacity = '0.3';
                    contactForm.style.pointerEvents = 'none';
                    contactSuccess.classList.remove('hidden');
                } else {
                    alert('Submission failed. Please try again or email us directly.');
                    submitBtn.textContent = originalText;
                    submitBtn.disabled = false;
                }
            })
            .catch(error => {
                console.error('Error submitting form:', error);
                alert('An error occurred. Please check your connection and try again.');
                submitBtn.textContent = originalText;
                submitBtn.disabled = false;
            });
        });
    }
})();
