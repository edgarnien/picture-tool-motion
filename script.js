class ImagePixelationTool {
    constructor() {
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.pixelCanvas = document.getElementById('pixelCanvas');
        this.pixelCtx = this.pixelCanvas.getContext('2d');
        this.originalImage = null;
        this.currentImageData = null;
        this.isColorMode = true;
        this.backgroundRemovalEnabled = false;
        this.backgroundImageEnabled = false;
        this.processingTimeout = null; // Add debouncing for performance
        
        // Motion animation state
        this.motionAnimationRunning = false;
        this.motionAnimationFrame = 0;
        this.motionBarOrder = [];
        this.motionBarTotalFrames = 120; // Longer animation (4 seconds at 30fps)
        this.motionAnimationRequestId = null;
        this.motionType = 'motion1'; // Current motion type
        this.animationSpeed = 1.0; // Animation speed multiplier (0.5x to 3x)
        this.motion2VisibleBars = []; // For motion 2 flickering
        this.motion3ImpulsePhase = 0; // For motion 3 impulse waves
        this.aspectRatio = 'original'; // Current aspect ratio setting
        
        // Default settings for reset functionality
        this.defaultSettings = {
            pixelSize: 80,
            threshold: 0,
            stretch: 0,
            sensitivity: 30,
            opacity: 30,
            motionType: 'motion1',
            speed: 1.0,
            aspectRatio: 'original',
            primaryColor: '#ffffff'
        };
        
        // Video recording state
        this.isRecording = false;
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.videoStream = null;
        this.isProcessingDownload = false;
        
        // Background color state
        this.backgroundColorEnabled = false;
        this.backgroundColor = '#FFFFFF';
        
        // Reverse mask state
        this.reverseMaskEnabled = false;
        
        this.initializeEventListeners();
        this.updateSliderValues();
    }

    initializeEventListeners() {
        // File input and drag & drop
        const fileInput = document.getElementById('fileInput');
        const uploadBtn = document.getElementById('uploadBtn');
        const dropZone = document.getElementById('dropZone');

        uploadBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => this.handleFileSelect(e.target.files[0]));

        // Mobile upload - click on main content area to upload
        const mainContent = document.querySelector('.main-content');
        const isMobile = () => window.innerWidth <= 768;
        
        mainContent.addEventListener('click', (e) => {
            if (isMobile() && !this.originalImage) {
                // Only trigger on mobile and when no image is loaded
                fileInput.click();
            }
        });

        // Drag and drop events
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('dragover');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file && this.isValidImageFile(file)) {
                this.handleFileSelect(file);
            }
        });

        // Mode toggle buttons
        document.getElementById('coloredBtn').addEventListener('click', () => this.setColorMode(true));
        document.getElementById('bwBtn').addEventListener('click', () => this.setColorMode(false));

        // Background removal toggle
        document.getElementById('backgroundRemovalBtn').addEventListener('click', () => this.toggleBackgroundRemoval());
        
        // Background image toggle
        document.getElementById('backgroundImageBtn').addEventListener('click', () => this.toggleBackgroundImage());
        
        // Sensitivity slider
        document.getElementById('sensitivitySlider').addEventListener('input', (e) => {
            document.getElementById('sensitivityValue').textContent = e.target.value;
            this.processImage();
            this.saveCurrentSettings(); // Save settings after change
        });

        // Opacity slider
        document.getElementById('opacitySlider').addEventListener('input', (e) => {
            document.getElementById('opacityValue').textContent = e.target.value;
            if (this.backgroundImageEnabled) {
                this.processImage();
            }
            this.saveCurrentSettings(); // Save settings after change
        });

        // Sliders with immediate live updates
        document.getElementById('sizeSlider').addEventListener('input', (e) => {
            document.getElementById('sizeValue').textContent = e.target.value;
            this.processImage(); // Immediate processing for live updates
            this.saveCurrentSettings(); // Save settings after change
        });

        document.getElementById('thresholdSlider').addEventListener('input', (e) => {
            document.getElementById('thresholdValue').textContent = e.target.value;
            this.processImage(); // Immediate processing for live updates
            this.saveCurrentSettings(); // Save settings after change
        });

        document.getElementById('stretchSlider').addEventListener('input', (e) => {
            const value = e.target.value.padStart(2, '0');
            document.getElementById('stretchValue').textContent = value;
            this.processImage(); // Immediate processing for live updates
            this.saveCurrentSettings(); // Save settings after change
        });

        // Download buttons
        document.getElementById('svgDownloadBtn').addEventListener('click', () => this.downloadSVG());
        document.getElementById('pngDownloadBtn').addEventListener('click', () => this.downloadPNG());
        
        // Reset Settings button
        document.getElementById('resetSettingsBtn').addEventListener('click', () => this.resetSettings());
        
        // Start/Stop Animation button
        document.getElementById('startStopMotionBtn').addEventListener('click', () => this.toggleMotionAnimation());
        // Motion type selector
        document.getElementById('motionTypeSelect').addEventListener('change', (e) => {
            this.setMotionType(e.target.value);
            this.saveCurrentSettings(); // Save settings after change
        });
        
        // Aspect ratio selector
        document.getElementById('aspectRatioSelect').addEventListener('change', (e) => {
            this.setAspectRatio(e.target.value);
            this.saveCurrentSettings(); // Save settings after change
        });
        
        // Speed slider for animation
        document.getElementById('speedSlider').addEventListener('input', (e) => {
            this.animationSpeed = parseFloat(e.target.value);
            document.getElementById('speedValue').textContent = `${this.animationSpeed.toFixed(1)}x`;
            this.saveCurrentSettings(); // Save settings after change
        });
        
        // Download Video button
        document.getElementById('videoDownloadBtn').addEventListener('click', () => this.downloadMotionVideo());
        
        // Background color controls
        document.getElementById('backgroundColorBtn').addEventListener('click', () => this.toggleBackgroundColor());
        document.getElementById('hexColorInput').addEventListener('input', (e) => {
            this.updateBackgroundColor(e.target.value);
            this.saveCurrentSettings(); // Save settings after change
        });
        document.getElementById('hexColorInput').addEventListener('change', (e) => {
            this.updateBackgroundColor(e.target.value);
            this.saveCurrentSettings(); // Save settings after change
        });
        
        // Color wheel controls
        document.getElementById('colorPreview').addEventListener('click', () => this.toggleColorWheel());
        document.getElementById('closeColorWheel').addEventListener('click', () => this.closeColorWheel());
        
        // Close color wheel when clicking outside (but not on color wheel itself)
        document.addEventListener('click', (e) => {
            const colorWheel = document.getElementById('colorWheelPopup');
            const colorPreview = document.getElementById('colorPreview');
            if (colorWheel.style.display === 'block' && 
                !colorWheel.contains(e.target) && 
                !colorPreview.contains(e.target)) {
                this.closeColorWheel();
            }
        });
        
        // Reverse mask control
        document.getElementById('reverseMaskBtn').addEventListener('click', () => this.toggleReverseMask());
    }

    toggleMotionAnimation() {
        if (this.motionAnimationRunning) {
            this.stopMotionAnimation();
        } else {
            this.startMotionAnimation();
        }
    }

    setMotionType(motionType) {
        this.motionType = motionType;
        
        // Reset motion-specific states
        this.motion2VisibleBars = [];
        this.motion3ImpulsePhase = 0;
        
        // If animation is running, restart it with new motion type
        if (this.motionAnimationRunning) {
            this.stopMotionAnimation();
            this.startMotionAnimation();
        }
    }

    setAspectRatio(aspectRatio) {
        this.aspectRatio = aspectRatio;
        
        if (this.originalImage) {
            // Reconfigure canvas with new aspect ratio
            this.setupCanvas(this.originalImage);
            this.processImage();
        }
    }

    startMotionAnimation() {
        if (!this.originalImage) {
            alert('Please upload an image first');
            return;
        }
        this.motionAnimationRunning = true;
        document.getElementById('startStopMotionBtn').textContent = window.innerWidth <= 768 ? 'STOP' : 'STOP ANIMATION';
        this.prepareMotionBarOrder();
        this.motionAnimationFrame = 0;
        this.runMotionAnimation();
    }

    stopMotionAnimation() {
        this.motionAnimationRunning = false;
        document.getElementById('startStopMotionBtn').textContent = window.innerWidth <= 768 ? 'START' : 'START ANIMATION';
        if (this.motionAnimationRequestId) {
            cancelAnimationFrame(this.motionAnimationRequestId);
            this.motionAnimationRequestId = null;
        }
        
        // If recording, stop the recording when animation completes
        if (this.isRecording && !this.isProcessingDownload) {
            setTimeout(() => {
                this.stopVideoRecording();
            }, 500); // Small delay to ensure last frames are captured
        }
        
        // Optionally, redraw the final image
        this.processImage();
    }

    prepareMotionBarOrder() {
        // Prepare a randomized order of bars for animation - only include visible bars
        const pixelSize = parseInt(document.getElementById('sizeSlider').value);
        const threshold = parseInt(document.getElementById('thresholdSlider').value);
        const stretchFactor = parseInt(document.getElementById('stretchSlider').value);
        const baseBarHeight = pixelSize * 3;
        const extraHeight = Math.floor(stretchFactor * 2);
        const desiredBarHeight = baseBarHeight + extraHeight;
        const width = this.canvas.width;
        const height = this.canvas.height;
        
        // Calculate actual bar height to ensure even distribution
        const numBarsVertically = Math.floor(height / desiredBarHeight);
        const totalBarHeight = numBarsVertically > 0 ? Math.floor(height / numBarsVertically) : desiredBarHeight;
        
        const imageData = this.ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        
        // Get background removal settings
        const sensitivity = this.isColorMode && this.backgroundRemovalEnabled ? 
            parseInt(document.getElementById('sensitivitySlider').value) : 0;
        
        // If background removal is enabled, detect dominant colors
        let dominantColors = [];
        if (this.isColorMode && this.backgroundRemovalEnabled) {
            const corners = [
                {x: 0, y: 0}, {x: width-1, y: 0}, 
                {x: 0, y: height-1}, {x: width-1, y: height-1}
            ];
            
            for (let corner of corners) {
                const index = (corner.y * width + corner.x) * 4;
                dominantColors.push({
                    r: data[index],
                    g: data[index + 1],
                    b: data[index + 2]
                });
            }
        }
        
        const bars = [];
        
        // Only add bars that would actually be visible in the final image
        for (let x = 0; x < width; x += pixelSize) {
            for (let y = 0; y < height; y += totalBarHeight) {
                // Sample a point in this area (same logic as in pixelateImage)
                const sampleX = Math.min(x + Math.floor(pixelSize / 2), width - 1);
                const sampleY = Math.min(y + Math.floor(totalBarHeight / 2), height - 1);
                const index = (sampleY * width + sampleX) * 4;
                
                let r = data[index] || 0;
                let g = data[index + 1] || 0;
                let b = data[index + 2] || 0;

                // Apply the same filtering logic as in pixelateImage
                if (!this.isColorMode) {
                    const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
                    r = g = b = gray > threshold * 2.55 ? 255 : 0;
                } else {
                    // In colored mode, check for background removal
                    if (this.backgroundRemovalEnabled && this.isBackgroundColor(r, g, b, sensitivity, dominantColors)) {
                        continue; // Skip background colors - don't add to animation
                    }
                    
                    r = r > threshold * 2.55 ? r : 0;
                    g = g > threshold * 2.55 ? g : 0;
                    b = b > threshold * 2.55 ? b : 0;
                }

                // Only add this bar if it would actually be visible (not black/transparent)
                if (r !== 0 || g !== 0 || b !== 0) {
                    bars.push({
                        x: x,
                        y: y,
                        r: r,
                        g: g,
                        b: b,
                        width: pixelSize,
                        height: totalBarHeight
                    });
                }
            }
        }
        
        // Shuffle bars randomly
        for (let i = bars.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [bars[i], bars[j]] = [bars[j], bars[i]];
        }
        
        this.motionBarOrder = bars;
        console.log(`Animation prepared: ${bars.length} visible bars will be animated`);
    }

    runMotionAnimation() {
        if (!this.motionAnimationRunning) return;
        
        // Route to different motion types
        switch (this.motionType) {
            case 'motion1':
                this.runMotion1Animation();
                break;
            case 'motion2':
                this.runMotion2Animation();
                break;
            case 'motion3':
                this.runMotion3Animation();
                break;
            case 'motion4':
                this.runMotion4Animation();
                break;
            default:
                this.runMotion1Animation();
        }
    }

    runMotion1Animation() {
        // BUILD UP animation - builds up then builds down in a continuous loop
        // Clear canvas for animation
        this.pixelCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Fill background with custom color if enabled
        if (this.backgroundColorEnabled) {
            this.pixelCtx.fillStyle = this.backgroundColor;
            this.pixelCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
        
        // Draw original image as background if enabled
        if (this.backgroundImageEnabled && this.originalImage) {
            const opacity = parseInt(document.getElementById('opacitySlider').value) / 100;
            this.pixelCtx.globalAlpha = opacity;
            this.drawOriginalImageToContext(this.pixelCtx, this.canvas.width, this.canvas.height);
            this.pixelCtx.globalAlpha = 1.0; // Reset opacity for bars
        }
        
        // Create looping build-up and build-down effect
        const halfCycle = this.motionBarTotalFrames / this.animationSpeed; // Time for one direction
        const fullCycle = halfCycle * 2; // Complete up + down cycle
        const currentFrame = this.motionAnimationFrame % fullCycle; // Loop the animation
        
        let visibleBarCount;
        if (currentFrame < halfCycle) {
            // BUILD UP phase: 0 to all bars
            const progress = currentFrame / halfCycle;
            visibleBarCount = Math.floor(progress * this.motionBarOrder.length);
        } else {
            // BUILD DOWN phase: all bars to 0
            const downProgress = (currentFrame - halfCycle) / halfCycle;
            visibleBarCount = Math.floor((1 - downProgress) * this.motionBarOrder.length);
        }
        
        // Draw only the bars that should be visible
        for (let i = 0; i < visibleBarCount; i++) {
            const bar = this.motionBarOrder[i];
            this.drawBar(bar);
        }
        
        this.updateDisplay();
        this.motionAnimationFrame++;
        
        // Loop continuously - never stop
        this.scheduleNextFrame();
    }

    runMotion2Animation() {
        // FLICKER animation - continuous gentle flickering of visible bars
        if (this.motionAnimationFrame === 0) {
            // Initialize: show all bars that were prepared (these are the visible ones from settings)
            this.motion2VisibleBars = [...this.motionBarOrder];
        }
        
        // Clear canvas
        this.pixelCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Fill background with custom color if enabled
        if (this.backgroundColorEnabled) {
            this.pixelCtx.fillStyle = this.backgroundColor;
            this.pixelCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
        
        // Draw original image as background if enabled
        if (this.backgroundImageEnabled && this.originalImage) {
            const opacity = parseInt(document.getElementById('opacitySlider').value) / 100;
            this.pixelCtx.globalAlpha = opacity;
            this.drawOriginalImageToContext(this.pixelCtx);
            this.pixelCtx.globalAlpha = 1.0;
        }
        
        // Speed-controlled flickering - adjust frame interval based on speed
        const flickerInterval = Math.max(1, Math.round(5 / this.animationSpeed)); // Slower base interval
        if (this.motionAnimationFrame % flickerInterval === 0) { // Flicker based on speed
            const toggleCount = Math.floor(this.motionBarOrder.length * (0.02 + Math.random() * 0.03)); // 2-5% per flicker
            for (let i = 0; i < toggleCount; i++) {
                const randomIndex = Math.floor(Math.random() * this.motionBarOrder.length);
                const bar = this.motionBarOrder[randomIndex];
                
                // Toggle visibility
                const visibleIndex = this.motion2VisibleBars.findIndex(b => 
                    b.x === bar.x && b.y === bar.y);
                
                if (visibleIndex >= 0) {
                    // Remove from visible (hide)
                    this.motion2VisibleBars.splice(visibleIndex, 1);
                } else {
                    // Add to visible (show)
                    this.motion2VisibleBars.push(bar);
                }
            }
        }
        
        // Draw visible bars
        for (const bar of this.motion2VisibleBars) {
            this.drawBar(bar);
        }
        
        this.updateDisplay();
        this.motionAnimationFrame++;
        
        // Loop continuously - never stop
        this.scheduleNextFrame();
    }

    runMotion3Animation() {
        // IMPULSE wave animation - continuous loop from center to edge and back
        // Clear canvas for animation
        this.pixelCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Fill background with custom color if enabled
        if (this.backgroundColorEnabled) {
            this.pixelCtx.fillStyle = this.backgroundColor;
            this.pixelCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
        
        // Draw original image as background if enabled
        if (this.backgroundImageEnabled && this.originalImage) {
            const opacity = parseInt(document.getElementById('opacitySlider').value) / 100;
            this.pixelCtx.globalAlpha = opacity;
            this.drawOriginalImageToContext(this.pixelCtx);
            this.pixelCtx.globalAlpha = 1.0;
        }
        
        // Create speed-controlled wave effect - cycles every 80 frames / speed
        const waveLength = 80 / this.animationSpeed;
        const wavePhase = (this.motionAnimationFrame % waveLength) / waveLength;
        
        // Wave position using sine wave for smooth back-and-forth motion
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;
        const maxDistance = Math.sqrt(centerX ** 2 + centerY ** 2);
        
        // Create back-and-forth wave: 0 -> 1 -> 0 using sine wave
        const sineWave = Math.sin(wavePhase * Math.PI * 2); // Full sine cycle
        const waveRadius = maxDistance * (0.5 + 0.5 * sineWave); // Maps -1,1 to 0,1
        const waveWidth = maxDistance * 0.12; // Slightly narrower for better performance
        
        // Batch render bars to avoid too many draw calls
        let drawnBars = 0;
        const maxBarsPerFrame = 350; // Slightly more bars for fuller effect
        
        for (const bar of this.motionBarOrder) {
            if (drawnBars >= maxBarsPerFrame) break;
            
            const distance = Math.sqrt((bar.x - centerX) ** 2 + (bar.y - centerY) ** 2);
            
            // Show bars that are within the wave front (ring effect)
            if (distance <= waveRadius + waveWidth && distance >= waveRadius - waveWidth) {
                this.drawBar(bar);
                drawnBars++;
            }
        }
        
        this.updateDisplay();
        this.motionAnimationFrame++;
        
        // Run continuously - never stop, just keep looping
        this.scheduleNextFrame();
    }

    runMotion4Animation() {
        // WAVE animation - loops continuously with random direction each cycle
        const loopFrames = (this.motionBarTotalFrames * 1.8) / this.animationSpeed;
        const currentCycle = Math.floor(this.motionAnimationFrame / loopFrames);
        const frameInCycle = this.motionAnimationFrame % loopFrames;
        
        // Choose new random direction for each cycle
        if (frameInCycle === 0) {
            this.waveDirection = Math.floor(Math.random() * 4); // 0=left, 1=right, 2=top, 3=bottom
            this.sortBarsForWave();
        }
        
        // Clear canvas for animation
        this.pixelCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Fill background with custom color if enabled
        if (this.backgroundColorEnabled) {
            this.pixelCtx.fillStyle = this.backgroundColor;
            this.pixelCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
        
        // Draw original image as background if enabled
        if (this.backgroundImageEnabled && this.originalImage) {
            const opacity = parseInt(document.getElementById('opacitySlider').value) / 100;
            this.pixelCtx.globalAlpha = opacity;
            this.drawOriginalImageToContext(this.pixelCtx);
            this.pixelCtx.globalAlpha = 1.0;
        }
        
        // Calculate progress within current cycle
        const rawProgress = frameInCycle / loopFrames;
        
        // Apply smooth easing
        const progress = rawProgress < 0.5 
            ? 2 * rawProgress * rawProgress 
            : 1 - Math.pow(-2 * rawProgress + 2, 3) / 2;
        
        const totalBars = this.motionBarOrder.length;
        
        if (progress <= 0.5) {
            // APPEAR phase: bars appear following wave direction (0 to all bars)
            const appearProgress = progress * 2; // 0 to 1
            const barsToShow = Math.floor(totalBars * appearProgress);
            
            for (let i = 0; i < barsToShow; i++) {
                this.drawBar(this.motionBarOrder[i]);
            }
        } else {
            // DISAPPEAR phase: bars disappear following same wave direction
            const disappearProgress = (progress - 0.5) * 2; // 0 to 1
            const barsToHide = Math.floor(totalBars * disappearProgress);
            const startIndex = barsToHide; // Start hiding from beginning
            const endIndex = totalBars; // Show remaining bars
            
            for (let i = startIndex; i < endIndex; i++) {
                this.drawBar(this.motionBarOrder[i]);
            }
        }
        
        this.updateDisplay();
        this.motionAnimationFrame++;
        
        // Loop continuously - never stop
        this.scheduleNextFrame();
    }

    sortBarsForWave() {
        // Sort bars based on wave direction for organic progression
        this.motionBarOrder.sort((a, b) => {
            switch (this.waveDirection) {
                case 0: // Left to right
                    return a.x - b.x;
                case 1: // Right to left
                    return b.x - a.x;
                case 2: // Top to bottom
                    return a.y - b.y;
                case 3: // Bottom to top
                    return b.y - a.y;
                default:
                    return 0;
            }
        });
    }

    drawBar(bar) {
        if (this.reverseMaskEnabled && this.originalImage) {
            // Reverse mask mode: draw original image portion instead of colored bar
            this.pixelCtx.save();
            this.pixelCtx.beginPath();
            this.pixelCtx.rect(bar.x, bar.y, bar.width, bar.height);
            this.pixelCtx.clip();
            this.drawOriginalImageToContext(this.pixelCtx, this.canvas.width, this.canvas.height);
            this.pixelCtx.restore();
        } else {
            // Normal mode: draw colored bar
            this.pixelCtx.fillStyle = `rgb(${bar.r},${bar.g},${bar.b})`;
            this.pixelCtx.fillRect(bar.x, bar.y, bar.width, bar.height);
        }
    }

    updateDisplay() {
        this.pixelCanvas.style.display = 'block';
        this.canvas.style.display = 'block';
        
        // Update video canvas if recording
        if (this.isRecording && this.videoCanvas) {
            this.videoCtx.clearRect(0, 0, this.videoCanvas.width, this.videoCanvas.height);
            
            // Fill background with custom color if enabled
            if (this.backgroundColorEnabled) {
                this.videoCtx.fillStyle = this.backgroundColor;
                this.videoCtx.fillRect(0, 0, this.videoCanvas.width, this.videoCanvas.height);
            }
            
            // Draw background image if enabled
            if (this.backgroundImageEnabled && this.originalImage) {
                const opacity = parseInt(document.getElementById('opacitySlider').value) / 100;
                this.videoCtx.globalAlpha = opacity;
                this.videoCtx.drawImage(this.originalImage, 0, 0, this.videoCanvas.width, this.videoCanvas.height);
                this.videoCtx.globalAlpha = 1.0; // Reset opacity for bars
            }
            
            // Draw the pixelated content at original size
            this.videoCtx.drawImage(this.pixelCanvas, 0, 0);
        }
    }

    scheduleNextFrame() {
        // Apply speed multiplier - lower values = slower animation
        const baseDelay = this.isRecording ? 50 : 100; // Base delays
        const adjustedDelay = Math.max(16, baseDelay / this.animationSpeed); // Min 16ms for smooth animation
        
        setTimeout(() => {
            this.motionAnimationRequestId = requestAnimationFrame(() => this.runMotionAnimation());
        }, adjustedDelay);
    }

    // --- Video Download Implementation ---
    downloadMotionVideo() {
        if (!this.originalImage) {
            alert('Please upload an image first');
            return;
        }

        if (this.isRecording) {
            this.stopVideoRecording();
        } else {
            this.startVideoRecording();
        }
    }

    async startVideoRecording() {
        try {
            // Prevent multiple recordings
            if (this.isRecording) {
                return;
            }

            // Create a high-resolution canvas for video recording using original dimensions
            const finalWidth = this.pixelCanvas.width;
            const finalHeight = this.pixelCanvas.height;

            this.videoCanvas = document.createElement('canvas');
            this.videoCanvas.width = finalWidth;
            this.videoCanvas.height = finalHeight;
            this.videoCtx = this.videoCanvas.getContext('2d');

            // Get canvas stream with higher frame rate from the video canvas
            this.videoStream = this.videoCanvas.captureStream(60); // 60 FPS for smoother video
            
            // Get user's preferred format
            const formatSelect = document.getElementById('videoFormatSelect');
            const preferredFormat = formatSelect ? formatSelect.value : 'mp4'; // Default to MP4
            
            // Set format based on user selection
            let options;
            
            if (preferredFormat === 'mp4') {
                // User wants MP4
                if (MediaRecorder.isTypeSupported('video/mp4;codecs=h264')) {
                    options = {
                        mimeType: 'video/mp4;codecs=h264',
                        videoBitsPerSecond: 10000000 // 10Mbps for high quality
                    };
                } else if (MediaRecorder.isTypeSupported('video/mp4')) {
                    options = {
                        mimeType: 'video/mp4',
                        videoBitsPerSecond: 10000000
                    };
                } else {
                    throw new Error('MP4 format is not supported by your browser. Please select WebM instead.');
                }
            } else if (preferredFormat === 'webm') {
                // User wants WebM
                if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
                    options = {
                        mimeType: 'video/webm;codecs=vp9',
                        videoBitsPerSecond: 8000000 // 8Mbps for high quality
                    };
                } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) {
                    options = {
                        mimeType: 'video/webm;codecs=vp8',
                        videoBitsPerSecond: 6000000 // 6Mbps for good quality
                    };
                } else if (MediaRecorder.isTypeSupported('video/webm')) {
                    options = {
                        mimeType: 'video/webm',
                        videoBitsPerSecond: 5000000 // 5Mbps for decent quality
                    };
                } else {
                    throw new Error('WebM format is not supported by your browser. Please select MP4 instead.');
                }
            } else {
                // Fallback to MP4 if somehow an invalid format is selected
                options = {
                    mimeType: 'video/mp4',
                    videoBitsPerSecond: 10000000
                };
            }

            console.log('Using codec:', options.mimeType);

            this.mediaRecorder = new MediaRecorder(this.videoStream, options);
            this.recordedChunks = [];

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    this.recordedChunks.push(event.data);
                    console.log('Data chunk added, size:', event.data.size);
                }
            };

            this.mediaRecorder.onstop = () => {
                // Just clean up, don't auto-download
                console.log('Recording stopped, total chunks:', this.recordedChunks.length);
            };

            this.mediaRecorder.onerror = (event) => {
                console.error('MediaRecorder error:', event.error);
                alert('Recording error: ' + event.error.message);
                this.resetVideoState();
            };

            // Start recording with smaller time slice for more frequent data collection
            this.mediaRecorder.start(200); // Collect data every 200ms
            this.isRecording = true;
            this.isProcessingDownload = false;
            
            // Update button text
            document.getElementById('videoDownloadBtn').textContent = 'Stop Recording ⏹';
            
            // Start the animation for recording
            this.startMotionAnimation();
            
            console.log('Recording started successfully');
            
        } catch (error) {
            console.error('Error starting video recording:', error);
            alert('Failed to start video recording. Error: ' + error.message + '\n\nYour browser might not support video recording.');
            this.resetVideoState();
        }
    }

    stopVideoRecording() {
        if (this.mediaRecorder && this.isRecording) {
            this.isRecording = false;
            this.mediaRecorder.stop();
            
            // Stop video stream
            if (this.videoStream) {
                this.videoStream.getTracks().forEach(track => track.stop());
                this.videoStream = null;
            }
            
            // Update button text
            document.getElementById('videoDownloadBtn').textContent = 'Download Video ↓';
            
            // Stop animation if running
            if (this.motionAnimationRunning) {
                this.stopMotionAnimation();
            }
            
            // Manually trigger download after a short delay to ensure recording is fully stopped
            setTimeout(() => {
                if (this.recordedChunks.length > 0 && !this.isProcessingDownload) {
                    this.downloadRecordedVideo();
                }
            }, 200);
        }
    }

    downloadRecordedVideo() {
        if (this.isProcessingDownload) {
            console.log('Download already in progress, skipping...');
            return; // Prevent multiple downloads
        }

        if (this.recordedChunks.length === 0) {
            alert('No video data recorded');
            this.resetVideoState();
            return;
        }

        this.isProcessingDownload = true;
        console.log('Starting video download with', this.recordedChunks.length, 'chunks...');

        try {
            // Calculate total size for debugging
            const totalSize = this.recordedChunks.reduce((sum, chunk) => sum + chunk.size, 0);
            console.log('Total video size:', totalSize, 'bytes');

            if (totalSize === 0) {
                throw new Error('Video data is empty');
            }

            // Determine the mime type from the MediaRecorder
            let mimeType = 'video/webm';
            if (this.mediaRecorder && this.mediaRecorder.mimeType) {
                mimeType = this.mediaRecorder.mimeType;
            }

            // Create blob from recorded chunks
            const blob = new Blob(this.recordedChunks, { type: mimeType });
            console.log('Created blob with type:', mimeType, 'and size:', blob.size);
            
            // Determine file extension and format name
            let extension = 'webm';
            let formatName = 'WebM';
            
            if (mimeType.includes('mp4')) {
                extension = 'mp4';
                formatName = 'MP4';
            } else if (mimeType.includes('webm')) {
                extension = 'webm';
                formatName = 'WebM';
            }
            
            // Create download link
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `pixelation-animation-${Date.now()}.${extension}`;
            
            // Add some attributes to ensure download works
            a.style.display = 'none';
            a.setAttribute('download', a.download);
            
            // Trigger download
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            // Clean up URL after a delay
            setTimeout(() => {
                URL.revokeObjectURL(url);
            }, 1000);
            
            // Reset state BEFORE showing alert to prevent any race conditions
            this.resetVideoState();
            
            // Show success message with format-specific advice
            let playbackAdvice = '';
            if (extension === 'mp4') {
                playbackAdvice = 'This MP4 file should play in most video players and browsers.';
            } else {
                playbackAdvice = 'If the WebM video doesn\'t play, try using VLC Media Player or Chrome browser.';
            }
            
            alert(`Video download started! The animation has been saved as a ${formatName} file.\n\nFile: ${a.download}\nSize: ${(blob.size / 1024 / 1024).toFixed(2)} MB\nFormat: ${formatName} (${mimeType})\n\n${playbackAdvice}`);
            
        } catch (error) {
            console.error('Error downloading video:', error);
            alert('Failed to download video. Error: ' + error.message + '\n\nPlease try again or use a different browser.');
            this.resetVideoState();
        }
    }

    resetVideoState() {
        console.log('Resetting video state...');
        this.recordedChunks = [];
        this.isRecording = false;
        this.isProcessingDownload = false;
        
        if (this.mediaRecorder) {
            this.mediaRecorder = null;
        }
        
        if (this.videoStream) {
            this.videoStream.getTracks().forEach(track => track.stop());
            this.videoStream = null;
        }
        
        // Clean up video canvas
        if (this.videoCanvas) {
            this.videoCanvas = null;
            this.videoCtx = null;
        }
        
        // Reset button text
        document.getElementById('videoDownloadBtn').textContent = 'Download Video ↓';
        console.log('Video state reset complete');
    }

    updateSliderValues() {
        document.getElementById('sizeValue').textContent = document.getElementById('sizeSlider').value;
        document.getElementById('thresholdValue').textContent = document.getElementById('thresholdSlider').value;
        const stretchValue = document.getElementById('stretchSlider').value.padStart(2, '0');
        document.getElementById('stretchValue').textContent = stretchValue;
        document.getElementById('sensitivityValue').textContent = document.getElementById('sensitivitySlider').value;
        document.getElementById('opacityValue').textContent = document.getElementById('opacitySlider').value;
        
        // Initialize background section visibility (show for colored mode, hide for b&w)
        document.getElementById('backgroundSection').style.display = this.isColorMode ? 'flex' : 'none';
    }

    isValidImageFile(file) {
        const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
        return validTypes.includes(file.type);
    }

    saveCurrentSettings() {
        const currentSettings = {
            pixelSize: parseInt(document.getElementById('sizeSlider').value),
            threshold: parseInt(document.getElementById('thresholdSlider').value),
            stretch: parseInt(document.getElementById('stretchSlider').value),
            sensitivity: parseInt(document.getElementById('sensitivitySlider').value),
            opacity: parseInt(document.getElementById('opacitySlider').value),
            motionType: document.getElementById('motionTypeSelect').value,
            speed: parseInt(document.getElementById('speedSlider').value),
            aspectRatio: document.getElementById('aspectRatioSelect').value,
            primaryColor: document.getElementById('hexColorInput').value
        };
        
        localStorage.setItem('pixelToolSettings', JSON.stringify(currentSettings));
    }

    loadSavedSettings() {
        const savedSettings = localStorage.getItem('pixelToolSettings');
        if (savedSettings) {
            try {
                const settings = JSON.parse(savedSettings);
                
                // Update UI elements with saved values
                document.getElementById('sizeSlider').value = settings.pixelSize || this.defaultSettings.pixelSize;
                document.getElementById('thresholdSlider').value = settings.threshold || this.defaultSettings.threshold;
                document.getElementById('stretchSlider').value = settings.stretch || this.defaultSettings.stretch;
                document.getElementById('sensitivitySlider').value = settings.sensitivity || this.defaultSettings.sensitivity;
                document.getElementById('opacitySlider').value = settings.opacity || this.defaultSettings.opacity;
                document.getElementById('motionTypeSelect').value = settings.motionType || this.defaultSettings.motionType;
                document.getElementById('speedSlider').value = settings.speed || this.defaultSettings.speed;
                document.getElementById('aspectRatioSelect').value = settings.aspectRatio || this.defaultSettings.aspectRatio;
                document.getElementById('hexColorInput').value = settings.primaryColor || this.defaultSettings.primaryColor;
                
                // Update corresponding display elements
                document.getElementById('sizeValue').textContent = settings.pixelSize || this.defaultSettings.pixelSize;
                document.getElementById('thresholdValue').textContent = settings.threshold || this.defaultSettings.threshold;
                document.getElementById('stretchValue').textContent = (settings.stretch || this.defaultSettings.stretch).toString().padStart(2, '0');
                document.getElementById('sensitivityValue').textContent = settings.sensitivity || this.defaultSettings.sensitivity;
                document.getElementById('opacityValue').textContent = settings.opacity || this.defaultSettings.opacity;
                document.querySelector('#speedValue').textContent = `${(settings.speed || this.defaultSettings.speed).toFixed(1)}x`;
                
                // Apply aspect ratio if it's not original
                if (settings.aspectRatio && settings.aspectRatio !== 'original') {
                    this.setAspectRatio(settings.aspectRatio);
                }
                
                // Update background color and visual elements
                this.updateBackgroundColor(settings.primaryColor || this.defaultSettings.primaryColor);
                
            } catch (e) {
                console.error('Error loading saved settings:', e);
            }
        }
    }

    resetSettings() {
        // Reset all toggle button states to OFF
        this.backgroundRemovalEnabled = false;
        this.backgroundImageEnabled = false;
        this.backgroundColorEnabled = false;
        this.reverseMaskEnabled = false;
        
        // Update background removal UI
        const backgroundRemovalBtn = document.getElementById('backgroundRemovalBtn');
        backgroundRemovalBtn.textContent = 'REMOVE BACK: OFF';
        backgroundRemovalBtn.classList.remove('active');
        document.getElementById('sensitivityCard').style.display = 'none';
        
        // Update background image UI
        const backgroundImageBtn = document.getElementById('backgroundImageBtn');
        backgroundImageBtn.textContent = 'SHOW IMAGE: OFF';
        backgroundImageBtn.classList.remove('active');
        document.getElementById('opacityCard').style.display = 'none';
        
        // Update background color UI
        const backgroundColorBtn = document.getElementById('backgroundColorBtn');
        backgroundColorBtn.textContent = 'BACK COLOR: OFF';
        backgroundColorBtn.classList.remove('active');
        document.getElementById('colorCard').style.display = 'none';
        
        // Update reverse mask UI
        const reverseMaskBtn = document.getElementById('reverseMaskBtn');
        reverseMaskBtn.textContent = 'MASK: OFF';
        reverseMaskBtn.classList.remove('active');
        
        // Update UI elements with default values
        document.getElementById('sizeSlider').value = this.defaultSettings.pixelSize;
        document.getElementById('thresholdSlider').value = this.defaultSettings.threshold;
        document.getElementById('stretchSlider').value = this.defaultSettings.stretch;
        document.getElementById('sensitivitySlider').value = this.defaultSettings.sensitivity;
        document.getElementById('opacitySlider').value = this.defaultSettings.opacity;
        document.getElementById('motionTypeSelect').value = this.defaultSettings.motionType;
        document.getElementById('speedSlider').value = this.defaultSettings.speed;
        document.getElementById('aspectRatioSelect').value = this.defaultSettings.aspectRatio;
        document.getElementById('hexColorInput').value = this.defaultSettings.primaryColor;
        
        // Update corresponding display elements
        document.getElementById('sizeValue').textContent = this.defaultSettings.pixelSize;
        document.getElementById('thresholdValue').textContent = this.defaultSettings.threshold;
        document.getElementById('stretchValue').textContent = this.defaultSettings.stretch.toString().padStart(2, '0');
        document.getElementById('sensitivityValue').textContent = this.defaultSettings.sensitivity;
        document.getElementById('opacityValue').textContent = this.defaultSettings.opacity;
        document.querySelector('#speedValue').textContent = `${this.defaultSettings.speed.toFixed(1)}x`;
        
        // Reset aspect ratio to original
        this.setAspectRatio(this.defaultSettings.aspectRatio);
        
        // Update background color and visual elements
        this.updateBackgroundColor(this.defaultSettings.primaryColor);
        
        // Remove saved settings from localStorage
        localStorage.removeItem('pixelToolSettings');
        
        // Re-process image if one is loaded
        if (this.originalImage) {
            this.processImage();
        }
    }

    handleFileSelect(file) {
        if (!file || !this.isValidImageFile(file)) {
            alert('Please select a valid image file (PNG, JPG, or WebP)');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                this.originalImage = img;
                this.setupCanvas(img);
                
                // Load saved settings before processing the image
                this.loadSavedSettings();
                
                this.processImage();
                document.getElementById('dropZone').classList.add('has-image');
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    setupCanvas(img) {
        // Use higher resolution to preserve image quality
        const maxWidth = 2000;  // Increased for high quality output
        const maxHeight = 2000; // Increased for high quality output
        let { width, height } = img;

        // Apply aspect ratio settings
        if (this.aspectRatio === '16:9') {
            // 16:9 aspect ratio (1920x1080) for presentations
            width = 1920;
            height = 1080;
        } else if (this.aspectRatio === '9:16') {
            // 9:16 aspect ratio (1080x1920)
            width = 1080;
            height = 1920;
        } else if (this.aspectRatio === '4:5') {
            // 4:5 aspect ratio (1080x1350)
            width = 1080;
            height = 1350;
        } else {
            // Original aspect ratio - use actual image dimensions without stretching
            width = img.width;
            height = img.height;
            
            // Only scale down if image is extremely large to prevent performance issues
            if (width > maxWidth || height > maxHeight) {
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width = Math.floor(width * ratio);
                height = Math.floor(height * ratio);
            }
        }

        // Set both canvases to the calculated size
        this.canvas.width = width;
        this.canvas.height = height;
        this.pixelCanvas.width = width;
        this.pixelCanvas.height = height;

        // Draw original image (properly handled for each aspect ratio)
        if (this.aspectRatio === 'original') {
            // For original, maintain proportions by drawing at calculated dimensions
            this.ctx.drawImage(img, 0, 0, width, height);
        } else {
            // For fixed aspect ratios, crop the image to fill the canvas exactly
            const imgAspect = img.width / img.height;
            const canvasAspect = width / height;
            
            let sourceWidth, sourceHeight, sourceX, sourceY;
            
            if (imgAspect > canvasAspect) {
                // Image is wider than target aspect ratio - crop sides
                sourceHeight = img.height;
                sourceWidth = img.height * canvasAspect;
                sourceX = (img.width - sourceWidth) / 2;
                sourceY = 0;
            } else {
                // Image is taller than target aspect ratio - crop top/bottom
                sourceWidth = img.width;
                sourceHeight = img.width / canvasAspect;
                sourceX = 0;
                sourceY = (img.height - sourceHeight) / 2;
            }
            
            // Clear canvas first
            this.ctx.clearRect(0, 0, width, height);
            
            // Draw the cropped portion of the image to fill the entire canvas
            // This maintains the original image proportions while cropping to fit
            this.ctx.drawImage(
                img, 
                sourceX, sourceY, sourceWidth, sourceHeight,  // Source rectangle (cropped area)
                0, 0, width, height  // Destination rectangle (entire canvas)
            );
        }
        
        // Store the image data for SVG export
        this.currentImageData = this.ctx.getImageData(0, 0, width, height);
    }

    // Helper method to draw original image with proper aspect ratio handling
    drawOriginalImageToContext(ctx, targetWidth = null, targetHeight = null) {
        if (!this.originalImage) return;
        
        // Default to canvas size if not specified
        if (targetWidth === null) targetWidth = ctx.canvas.width;
        if (targetHeight === null) targetHeight = ctx.canvas.height;
        
        if (this.aspectRatio === 'original') {
            // For original, draw at actual size or scaled proportionally
            const scaleX = targetWidth / this.originalImage.width;
            const scaleY = targetHeight / this.originalImage.height;
            const scale = Math.min(scaleX, scaleY);
            
            const drawWidth = this.originalImage.width * scale;
            const drawHeight = this.originalImage.height * scale;
            const drawX = (targetWidth - drawWidth) / 2;
            const drawY = (targetHeight - drawHeight) / 2;
            
            ctx.drawImage(this.originalImage, drawX, drawY, drawWidth, drawHeight);
        } else {
            // For fixed aspect ratios, crop the image to fill completely
            const imgAspect = this.originalImage.width / this.originalImage.height;
            const targetAspect = targetWidth / targetHeight;
            
            let sourceWidth, sourceHeight, sourceX, sourceY;
            
            if (imgAspect > targetAspect) {
                // Image is wider than target aspect ratio - crop sides
                sourceHeight = this.originalImage.height;
                sourceWidth = this.originalImage.height * targetAspect;
                sourceX = (this.originalImage.width - sourceWidth) / 2;
                sourceY = 0;
            } else {
                // Image is taller than target aspect ratio - crop top/bottom
                sourceWidth = this.originalImage.width;
                sourceHeight = this.originalImage.width / targetAspect;
                sourceX = 0;
                sourceY = (this.originalImage.height - sourceHeight) / 2;
            }
            
            // Draw the cropped portion to fill the entire target area
            ctx.drawImage(
                this.originalImage, 
                sourceX, sourceY, sourceWidth, sourceHeight,  // Source rectangle (cropped area)
                0, 0, targetWidth, targetHeight  // Destination rectangle (entire target)
            );
        }
    }

    setColorMode(isColor) {
        this.isColorMode = isColor;
        
        // Update button states
        document.getElementById('coloredBtn').classList.toggle('active', isColor);
        document.getElementById('bwBtn').classList.toggle('active', !isColor);
        
        // Show/hide background removal section (only for colored mode)
        const backgroundSection = document.getElementById('backgroundSection');
        backgroundSection.style.display = isColor ? 'flex' : 'none';
        
        if (this.originalImage) {
            this.processImage();
        }
    }

    toggleBackgroundRemoval() {
        this.backgroundRemovalEnabled = !this.backgroundRemovalEnabled;
        const btn = document.getElementById('backgroundRemovalBtn');
        const sensitivityCard = document.getElementById('sensitivityCard');
        
        if (this.backgroundRemovalEnabled) {
            btn.textContent = window.innerWidth <= 768 ? 'ON' : 'REMOVE BACK: ON';
            btn.classList.add('active');
            sensitivityCard.style.display = 'block';
        } else {
            btn.textContent = window.innerWidth <= 768 ? 'OFF' : 'REMOVE BACK: OFF';
            btn.classList.remove('active');
            sensitivityCard.style.display = 'none';
        }
        
        if (this.originalImage) {
            this.processImage();
        }
    }

    toggleBackgroundImage() {
        this.backgroundImageEnabled = !this.backgroundImageEnabled;
        const btn = document.getElementById('backgroundImageBtn');
        const opacityCard = document.getElementById('opacityCard');
        
        if (this.backgroundImageEnabled) {
            btn.textContent = window.innerWidth <= 768 ? 'ON' : 'SHOW IMAGE: ON';
            btn.classList.add('active');
            opacityCard.style.display = 'block';
        } else {
            btn.textContent = window.innerWidth <= 768 ? 'OFF' : 'SHOW IMAGE: OFF';
            btn.classList.remove('active');
            opacityCard.style.display = 'none';
        }
        
        if (this.originalImage) {
            this.processImage();
        }
    }

    toggleBackgroundColor() {
        this.backgroundColorEnabled = !this.backgroundColorEnabled;
        const btn = document.getElementById('backgroundColorBtn');
        const colorCard = document.getElementById('colorCard');
        
        if (this.backgroundColorEnabled) {
            btn.textContent = window.innerWidth <= 768 ? 'ON' : 'BACK COLOR: ON';
            btn.classList.add('active');
            colorCard.style.display = 'block';
        } else {
            btn.textContent = window.innerWidth <= 768 ? 'OFF' : 'BACK COLOR: OFF';
            btn.classList.remove('active');
            colorCard.style.display = 'none';
        }
        
        if (this.originalImage) {
            this.processImage();
        }
    }

    updateBackgroundColor(hexValue) {
        // Validate hex color format
        if (hexValue.startsWith('#') && hexValue.length === 7) {
            const isValidHex = /^#[0-9A-F]{6}$/i.test(hexValue);
            if (isValidHex) {
                this.backgroundColor = hexValue;
                document.getElementById('hexColorInput').value = hexValue; // Update hex input live
                document.getElementById('colorPreview').style.backgroundColor = hexValue;
                
                if (this.backgroundColorEnabled && this.originalImage) {
                    this.processImage();
                }
            }
        } else if (hexValue.length === 6 && /^[0-9A-F]{6}$/i.test(hexValue)) {
            // Handle case where user didn't include #
            const fullHex = '#' + hexValue;
            this.backgroundColor = fullHex;
            document.getElementById('hexColorInput').value = fullHex;
            document.getElementById('colorPreview').style.backgroundColor = fullHex;
            
            if (this.backgroundColorEnabled && this.originalImage) {
                this.processImage();
            }
        }
    }

    toggleColorWheel() {
        const popup = document.getElementById('colorWheelPopup');
        if (popup.style.display === 'block') {
            this.closeColorWheel();
        } else {
            this.openColorWheel();
        }
    }

    openColorWheel() {
        const popup = document.getElementById('colorWheelPopup');
        const colorPreview = document.getElementById('colorPreview');
        
        // Position the color wheel next to the color preview field
        const rect = colorPreview.getBoundingClientRect();
        const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        
        // Position to the right of the color preview, or left if not enough space
        const spaceOnRight = window.innerWidth - (rect.right + 250); // 250 is wheel width
        let left, top;
        
        if (spaceOnRight > 20) {
            // Position to the right
            left = rect.right + scrollLeft + 10;
        } else {
            // Position to the left
            left = rect.left + scrollLeft - 260;
        }
        
        top = rect.top + scrollTop;
        
        // Ensure it doesn't go off screen vertically
        if (top + 300 > window.innerHeight + scrollTop) {
            top = window.innerHeight + scrollTop - 320;
        }
        
        popup.style.left = left + 'px';
        popup.style.top = top + 'px';
        popup.style.display = 'block';
        
        this.initializeColorWheel();
    }

    closeColorWheel() {
        const popup = document.getElementById('colorWheelPopup');
        popup.style.display = 'none';
        
        // Clean up global event handlers
        if (this.colorWheelHandlers) {
            document.removeEventListener('mousemove', this.colorWheelHandlers.handleMouseMove);
            document.removeEventListener('mouseup', this.colorWheelHandlers.handleMouseUp);
            this.colorWheelHandlers = null;
        }
        
        // Reset cursor position
        this.currentCursorPos = null;
    }

    initializeColorWheel() {
        const canvas = document.getElementById('colorWheelCanvas');
        const ctx = canvas.getContext('2d');
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const radius = Math.min(centerX, centerY) - 10;

        // Store wheel properties for cursor drawing
        this.wheelCenter = { x: centerX, y: centerY };
        this.wheelRadius = radius;
        this.currentCursorPos = null;

        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw color wheel
        for (let angle = 0; angle < 360; angle += 1) {
            const startAngle = (angle - 1) * Math.PI / 180;
            const endAngle = angle * Math.PI / 180;
            
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, startAngle, endAngle);
            ctx.arc(centerX, centerY, radius * 0.3, endAngle, startAngle, true);
            ctx.closePath();
            
            const hue = angle;
            const saturation = 100;
            const lightness = 50;
            ctx.fillStyle = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
            ctx.fill();
        }

        // Draw black and white sections in the center
        this.drawBlackWhiteCenter(ctx, centerX, centerY, radius * 0.3);

        // Add click and drag handlers for color selection
        canvas.onclick = (e) => this.selectColorFromWheel(e);
        
        // Add drag functionality for live color updates with global mouse tracking
        let isDragging = false;
        
        canvas.onmousedown = (e) => {
            isDragging = true;
            this.selectColorFromWheel(e);
            e.preventDefault();
        };
        
        // Use global mouse events for better dragging experience
        const handleMouseMove = (e) => {
            if (isDragging) {
                this.selectColorFromWheel(e, true); // Pass true for global tracking
            }
        };
        
        const handleMouseUp = () => {
            if (isDragging) {
                isDragging = false;
                // Clear cursor when stopping drag
                this.currentCursorPos = null;
                this.redrawColorWheel();
            }
        };
        
        // Attach global mouse events
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        
        // Store event handlers for cleanup
        this.colorWheelHandlers = { handleMouseMove, handleMouseUp };
        
        // Add brightness slider handler for live updates
        const brightnessSlider = document.getElementById('brightnessSlider');
        brightnessSlider.oninput = () => {
            // If we have a current color selection, update it with new brightness
            if (this.lastSelectedHue !== undefined && this.lastSelectedSaturation !== undefined) {
                const brightness = brightnessSlider.value;
                const hsl = { h: this.lastSelectedHue, s: this.lastSelectedSaturation, l: brightness / 2 };
                const rgb = this.hslToRgb(hsl.h, hsl.s, hsl.l);
                const hex = this.rgbToHex(rgb.r, rgb.g, rgb.b);
                this.updateBackgroundColor(hex);
            }
        };
    }

    drawBlackWhiteCenter(ctx, centerX, centerY, innerRadius) {
        // Draw black semicircle (left half)
        ctx.beginPath();
        ctx.arc(centerX, centerY, innerRadius, Math.PI / 2, 3 * Math.PI / 2);
        ctx.closePath();
        ctx.fillStyle = '#000000';
        ctx.fill();
        
        // Draw white semicircle (right half)
        ctx.beginPath();
        ctx.arc(centerX, centerY, innerRadius, -Math.PI / 2, Math.PI / 2);
        ctx.closePath();
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        
        // Add a thin border around the center circle
        ctx.beginPath();
        ctx.arc(centerX, centerY, innerRadius, 0, 2 * Math.PI);
        ctx.strokeStyle = '#666666';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    redrawColorWheel() {
        const canvas = document.getElementById('colorWheelCanvas');
        const ctx = canvas.getContext('2d');
        const centerX = this.wheelCenter.x;
        const centerY = this.wheelCenter.y;
        const radius = this.wheelRadius;

        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw color wheel
        for (let angle = 0; angle < 360; angle += 1) {
            const startAngle = (angle - 1) * Math.PI / 180;
            const endAngle = angle * Math.PI / 180;
            
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, startAngle, endAngle);
            ctx.arc(centerX, centerY, radius * 0.3, endAngle, startAngle, true);
            ctx.closePath();
            
            const hue = angle;
            const saturation = 100;
            const lightness = 50;
            ctx.fillStyle = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
            ctx.fill();
        }

        // Draw black and white sections in the center
        this.drawBlackWhiteCenter(ctx, centerX, centerY, radius * 0.3);

        // Draw cursor circle if position is set
        if (this.currentCursorPos) {
            ctx.beginPath();
            ctx.arc(this.currentCursorPos.x, this.currentCursorPos.y, 6, 0, 2 * Math.PI);
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 2;
            ctx.stroke();
            
            // Add black outline for better visibility
            ctx.beginPath();
            ctx.arc(this.currentCursorPos.x, this.currentCursorPos.y, 6, 0, 2 * Math.PI);
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    }

    selectColorFromWheel(e, isGlobalEvent = false) {
        const canvas = document.getElementById('colorWheelCanvas');
        const rect = canvas.getBoundingClientRect();
        
        let x, y;
        if (isGlobalEvent) {
            // For global mouse events, calculate relative to canvas
            x = e.clientX - rect.left;
            y = e.clientY - rect.top;
        } else {
            // For canvas-local events
            x = e.clientX - rect.left;
            y = e.clientY - rect.top;
        }
        
        const centerX = this.wheelCenter.x;
        const centerY = this.wheelCenter.y;
        
        // Calculate distance from center
        const dx = x - centerX;
        const dy = y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const radius = this.wheelRadius;
        
        // Check if click is in the black/white center area
        if (distance <= radius * 0.3) {
            // Determine if click is on black (left) or white (right) side
            const isLeftSide = dx < 0;
            const selectedColor = isLeftSide ? '#000000' : '#FFFFFF';
            
            // Update cursor position to center of selected half
            const offsetX = isLeftSide ? -radius * 0.15 : radius * 0.15;
            this.currentCursorPos = { x: centerX + offsetX, y: centerY };
            
            // Update color
            this.updateBackgroundColor(selectedColor);
            this.redrawColorWheel();
            return;
        }
        
        // For global events, allow selection even outside wheel bounds (clamp to wheel edges)
        let finalX = x;
        let finalY = y;
        let finalDistance = distance;
        
        if (isGlobalEvent || distance >= radius * 0.3) {
            // Clamp position to wheel bounds for color calculation
            if (distance > radius) {
                const ratio = radius / distance;
                finalX = centerX + dx * ratio;
                finalY = centerY + dy * ratio;
                finalDistance = radius;
            } else if (distance < radius * 0.3) {
                const ratio = (radius * 0.3) / distance;
                finalX = centerX + dx * ratio;
                finalY = centerY + dy * ratio;
                finalDistance = radius * 0.3;
            }
            
            // Calculate angle (hue) from final position
            const finalDx = finalX - centerX;
            const finalDy = finalY - centerY;
            let angle = Math.atan2(finalDy, finalDx) * 180 / Math.PI;
            if (angle < 0) angle += 360;
            
            // Calculate saturation based on distance from center
            const saturation = Math.min(100, ((finalDistance - radius * 0.3) / (radius * 0.7)) * 100);
            
            // Store current selection for brightness changes
            this.lastSelectedHue = angle;
            this.lastSelectedSaturation = saturation;
            
            // Update cursor position (use actual mouse position, not clamped position)
            this.currentCursorPos = { x: finalX, y: finalY };
            
            // Get brightness from slider
            const brightness = document.getElementById('brightnessSlider').value;
            
            // Convert HSL to RGB then to hex
            const hsl = { h: angle, s: saturation, l: brightness / 2 };
            const rgb = this.hslToRgb(hsl.h, hsl.s, hsl.l);
            const hex = this.rgbToHex(rgb.r, rgb.g, rgb.b);
            
            // Update color input and preview (but keep wheel open for live updates)
            this.updateBackgroundColor(hex);
            
            // Redraw wheel with cursor
            this.redrawColorWheel();
        }
    }

    hslToRgb(h, s, l) {
        h /= 360;
        s /= 100;
        l /= 100;
        
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        
        let r, g, b;
        if (s === 0) {
            r = g = b = l;
        } else {
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }
        
        return {
            r: Math.round(r * 255),
            g: Math.round(g * 255),
            b: Math.round(b * 255)
        };
    }

    rgbToHex(r, g, b) {
        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
    }

    toggleReverseMask() {
        this.reverseMaskEnabled = !this.reverseMaskEnabled;
        const btn = document.getElementById('reverseMaskBtn');
        
        if (this.reverseMaskEnabled) {
            btn.textContent = window.innerWidth <= 768 ? 'ON' : 'MASK: ON';
            btn.classList.add('active');
        } else {
            btn.textContent = window.innerWidth <= 768 ? 'OFF' : 'MASK: OFF';
            btn.classList.remove('active');
        }
        
        if (this.originalImage) {
            this.processImage();
        }
    }

    processImage() {
        if (!this.originalImage) return;

        const size = parseInt(document.getElementById('sizeSlider').value);
        const threshold = parseInt(document.getElementById('thresholdSlider').value);
        const stretchFactor = parseInt(document.getElementById('stretchSlider').value);

        this.pixelateImage(size, threshold, stretchFactor);
    }

    debouncedProcessImage() {
        // Clear previous timeout
        if (this.processingTimeout) {
            clearTimeout(this.processingTimeout);
        }
        
        // Set new timeout for smoother performance - increased delay
        this.processingTimeout = setTimeout(() => {
            this.processImage();
        }, 200); // Increased to 200ms delay for better performance
    }

    // Helper function to calculate color difference
    colorDistance(r1, g1, b1, r2, g2, b2) {
        return Math.sqrt((r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2);
    }

    // Helper function to determine if a color should be considered background
    isBackgroundColor(r, g, b, sensitivity, dominantColors) {
        const colorThreshold = (100 - sensitivity) * 2.55; // Convert 0-100 to 0-255 range
        
        // Check if this color is similar to any dominant color
        for (let domColor of dominantColors) {
            if (this.colorDistance(r, g, b, domColor.r, domColor.g, domColor.b) < colorThreshold) {
                return true;
            }
        }
        return false;
    }

    pixelateImage(pixelSize, threshold, stretchFactor) {
        const { width, height } = this.canvas;
        const imageData = this.ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        
        // Clear the canvas first
        this.pixelCtx.clearRect(0, 0, width, height);
        
        // Fill background with custom color if enabled
        if (this.backgroundColorEnabled) {
            this.pixelCtx.fillStyle = this.backgroundColor;
            this.pixelCtx.fillRect(0, 0, width, height);
        }
        
        // Draw original image as background if enabled
        if (this.backgroundImageEnabled && this.originalImage) {
            const opacity = parseInt(document.getElementById('opacitySlider').value) / 100;
            this.pixelCtx.globalAlpha = opacity;
            this.drawOriginalImageToContext(this.pixelCtx);
            this.pixelCtx.globalAlpha = 1.0; // Reset opacity for bars
        }
        
        // NEW APPROACH: Create vertical bars by sampling horizontally and drawing tall rectangles
        const barWidth = pixelSize; // Width of each vertical bar
        const baseBarHeight = pixelSize * 3; // Base height (always taller than width)
        const extraHeight = Math.floor(stretchFactor * 2); // Additional height based on stretch factor
        const desiredBarHeight = baseBarHeight + extraHeight;
        
        // Calculate actual bar height to ensure even distribution
        const numBarsVertically = Math.floor(height / desiredBarHeight);
        const totalBarHeight = numBarsVertically > 0 ? Math.floor(height / numBarsVertically) : desiredBarHeight;
        
        // Get background removal settings
        const sensitivity = this.isColorMode && this.backgroundRemovalEnabled ? 
            parseInt(document.getElementById('sensitivitySlider').value) : 0;
        
        // If background removal is enabled, detect dominant colors (simplified approach)
        let dominantColors = [];
        if (this.isColorMode && this.backgroundRemovalEnabled) {
            // Sample corner pixels to detect likely background colors
            const corners = [
                {x: 0, y: 0}, {x: width-1, y: 0}, 
                {x: 0, y: height-1}, {x: width-1, y: height-1}
            ];
            
            for (let corner of corners) {
                const index = (corner.y * width + corner.x) * 4;
                dominantColors.push({
                    r: data[index],
                    g: data[index + 1],
                    b: data[index + 2]
                });
            }
        }
        
        // Draw vertical bars across the image
        for (let x = 0; x < width; x += barWidth) {
            for (let y = 0; y < height; y += totalBarHeight) {
                // Sample a point in this area
                const sampleX = Math.min(x + Math.floor(barWidth / 2), width - 1);
                const sampleY = Math.min(y + Math.floor(totalBarHeight / 2), height - 1);
                const index = (sampleY * width + sampleX) * 4;
                
                let r = data[index] || 0;
                let g = data[index + 1] || 0;
                let b = data[index + 2] || 0;

                // Apply color mode and threshold
                if (!this.isColorMode) {
                    const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
                    r = g = b = gray > threshold * 2.55 ? 255 : 0;
                } else {
                    // In colored mode, check for background removal
                    if (this.backgroundRemovalEnabled && this.isBackgroundColor(r, g, b, sensitivity, dominantColors)) {
                        continue; // Skip background colors
                    }
                    
                    r = r > threshold * 2.55 ? r : 0;
                    g = g > threshold * 2.55 ? g : 0;
                    b = b > threshold * 2.55 ? b : 0;
                }

                // Skip black/transparent pixels
                if (r === 0 && g === 0 && b === 0) continue;

                // Draw the vertical bar
                if (this.reverseMaskEnabled && this.originalImage) {
                    // Reverse mask mode: draw original image portion instead of colored bar
                    this.pixelCtx.save();
                    this.pixelCtx.beginPath();
                    this.pixelCtx.rect(x, y, barWidth, totalBarHeight);
                    this.pixelCtx.clip();
                    this.drawOriginalImageToContext(this.pixelCtx);
                    this.pixelCtx.restore();
                } else {
                    // Normal mode: draw colored bar
                    this.pixelCtx.fillStyle = `rgb(${r},${g},${b})`;
                    this.pixelCtx.fillRect(x, y, barWidth, totalBarHeight);
                }
            }
        }
        
        this.pixelCanvas.style.display = 'block';
        this.canvas.style.display = 'block';
    }

    downloadSVG() {
        if (!this.currentImageData) {
            alert('Please upload an image first');
            return;
        }

        try {
            const { width, height } = this.canvas;
            const imageData = this.currentImageData;
            const data = imageData.data;
            
            // Get values directly from DOM elements
            const pixelSize = parseInt(document.getElementById('sizeSlider').value);
            const threshold = parseInt(document.getElementById('thresholdSlider').value);
            const stretchFactor = parseInt(document.getElementById('stretchSlider').value);
            const sensitivity = this.isColorMode && this.backgroundRemovalEnabled ? 
                parseInt(document.getElementById('sensitivitySlider').value) : 0;

            // Use the same NEW METHOD as in pixelateImage
            const barWidth = pixelSize;
            const baseBarHeight = pixelSize * 3;
            const extraHeight = Math.floor(stretchFactor * 2);
            const desiredBarHeight = baseBarHeight + extraHeight;

            // Calculate actual bar height to ensure even distribution
            const numBarsVertically = Math.floor(height / desiredBarHeight);
            const totalBarHeight = numBarsVertically > 0 ? Math.floor(height / numBarsVertically) : desiredBarHeight;

            // Detect dominant colors for background removal (same as pixelateImage)
            let dominantColors = [];
            if (this.isColorMode && this.backgroundRemovalEnabled) {
                const corners = [
                    {x: 0, y: 0}, {x: width-1, y: 0}, 
                    {x: 0, y: height-1}, {x: width-1, y: height-1}
                ];
                
                for (let corner of corners) {
                    const index = (corner.y * width + corner.x) * 4;
                    dominantColors.push({
                        r: data[index],
                        g: data[index + 1],
                        b: data[index + 2]
                    });
                }
            }

            // Build SVG content
            let svgRects = '';
            
            // Create vertical bars using the same algorithm as pixelateImage
            for (let x = 0; x < width; x += barWidth) {
                for (let y = 0; y < height; y += totalBarHeight) {
                    const sampleX = Math.min(x + Math.floor(barWidth / 2), width - 1);
                    const sampleY = Math.min(y + Math.floor(totalBarHeight / 2), height - 1);
                    const index = (sampleY * width + sampleX) * 4;
                    
                    let r = data[index] || 0;
                    let g = data[index + 1] || 0;
                    let b = data[index + 2] || 0;

                    if (!this.isColorMode) {
                        const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
                        // INVERT: black becomes white, white becomes black
                        r = g = b = gray > threshold * 2.55 ? 0 : 255;
                    } else {
                        // In colored mode, check for background removal
                        if (this.backgroundRemovalEnabled && this.isBackgroundColor(r, g, b, sensitivity, dominantColors)) {
                            continue; // Skip background colors
                        }
                        
                        r = r > threshold * 2.55 ? r : 0;
                        g = g > threshold * 2.55 ? g : 0;
                        b = b > threshold * 2.55 ? b : 0;
                    }

                    // Skip black/transparent pixels
                    if (r === 0 && g === 0 && b === 0) continue;

                    svgRects += `<rect x="${x}" y="${y}" width="${barWidth}" height="${totalBarHeight}" fill="rgb(${r},${g},${b})"/>\n`;
                }
            }

            // Complete SVG content with optional background
            let backgroundElement = '';
            if (this.backgroundImageEnabled && this.originalImage) {
                const opacity = parseInt(document.getElementById('opacitySlider').value) / 100;
                // Convert image to base64 for embedding in SVG
                const backgroundCanvas = document.createElement('canvas');
                const backgroundCtx = backgroundCanvas.getContext('2d');
                backgroundCanvas.width = width;
                backgroundCanvas.height = height;
                backgroundCtx.drawImage(this.originalImage, 0, 0, width, height);
                const base64Image = backgroundCanvas.toDataURL('image/png');
                
                backgroundElement = `<image href="${base64Image}" x="0" y="0" width="${width}" height="${height}" opacity="${opacity}"/>\n`;
            }

            const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
${backgroundElement}${svgRects}</svg>`;

            // Alternative download method using data URL
            const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgContent);
            
            // Create and trigger download
            const link = document.createElement('a');
            link.href = dataUrl;
            link.download = 'pixelated-image.svg';
            
            // Ensure link is visible and part of DOM for some browsers
            link.style.position = 'absolute';
            link.style.left = '-9999px';
            document.body.appendChild(link);
            
            // Trigger download
            link.click();
            
            // Clean up
            setTimeout(() => {
                document.body.removeChild(link);
            }, 100);
            
            alert('SVG download should start now!');
            
        } catch (error) {
            alert('SVG download failed: ' + error.message);
        }
    }

    downloadPNG() {
        if (!this.originalImage) {
            alert('Please upload an image first');
            return;
        }

        // Use original image dimensions to preserve quality
        const finalWidth = this.pixelCanvas.width;
        const finalHeight = this.pixelCanvas.height;

        // Create a temporary canvas for the final composite image
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCanvas.width = finalWidth;
        tempCanvas.height = finalHeight;

        // Clear the temporary canvas
        tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);

        // Fill background with custom color if enabled
        if (this.backgroundColorEnabled) {
            tempCtx.fillStyle = this.backgroundColor;
            tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        }

        // Draw background image if enabled
        if (this.backgroundImageEnabled && this.originalImage) {
            const opacity = parseInt(document.getElementById('opacitySlider').value) / 100;
            tempCtx.globalAlpha = opacity;
            tempCtx.drawImage(this.originalImage, 0, 0, finalWidth, finalHeight);
            tempCtx.globalAlpha = 1.0; // Reset opacity
        }

        // Draw the pixelated bars on top (using original size)
        tempCtx.drawImage(this.pixelCanvas, 0, 0);

        // Convert to blob and download with high quality
        tempCanvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'pixelated-image.png';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 'image/png'); // PNG format for lossless quality
    }

    downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

// Initialize the tool when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new ImagePixelationTool();
});
