class ImagePixelationTool {
    constructor() {
        // Initialize upload system FIRST - this is critical and must never fail
        this.initializeUploadSystem();

        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.pixelCanvas = document.getElementById('pixelCanvas');
        this.pixelCtx = this.pixelCanvas.getContext('2d');

        // Multi-image state management
        this.images = []; // Array of {img, id, thumbnailUrl}
        this.currentImageIndex = 0;
        this.originalImage = null; // Keep for backwards compatibility
        this.isGalleryExpanded = false;
        this.animationCycleCount = 0;
        this.lastCycleNumber = -1;

        this.isColorMode = true;
        this.backgroundRemovalEnabled = false;
        this.backgroundImageEnabled = false;
        this.processingTimeout = null;

        // Motion animation state
        this.motionAnimationRunning = false;
        this.motionAnimationFrame = 0;
        this.motionBarOrder = [];
        this.motionBarTotalFrames = 120;
        this.baseCycleDuration = 6000; // Base cycle duration in ms (6 seconds at 1.0x speed)
        this.motionAnimationRequestId = null;
        this.motionType = 'motion1'; // Current motion type
        this.animationSpeed = 1.0; // Animation speed multiplier (0.5x to 10x)
        this.aspectRatio = 'original'; // Current aspect ratio setting
        this.animationStartTime = 0; // For time-based animation
        this.lastWaveCycle = -1; // For motion 4 wave cycle tracking

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

        // Initialize other event listeners (isolated from upload)
        this.initializeEventListeners();
        this.initializeGallerySystem();
        this.safeUpdateSliderValues();
    }

    // ===========================================
    // MULTI-IMAGE GALLERY SYSTEM
    // ===========================================
    initializeGallerySystem() {
        // Gallery UI is now in HTML, just setup event listeners
        this.setupGalleryEventListeners();
    }

    setupGalleryEventListeners() {
        // Click on mini-viewer stack to toggle expand
        const miniViewerStack = document.getElementById('miniViewerStack');
        if (miniViewerStack) {
            miniViewerStack.addEventListener('click', (e) => {
                if (!e.target.classList.contains('thumb-delete-btn')) {
                    this.toggleGalleryExpand();
                }
            });
        }

        // Close expanded view when clicking outside
        document.addEventListener('click', (e) => {
            const miniViewer = document.getElementById('miniViewer');
            if (this.isGalleryExpanded && miniViewer && !miniViewer.contains(e.target)) {
                this.closeGallery();
            }
        });
    }

    // Add image to the multi-image array
    addImage(img) {
        const imageId = 'img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

        // Create thumbnail
        const thumbnailCanvas = document.createElement('canvas');
        const thumbSize = 80;
        thumbnailCanvas.width = thumbSize;
        thumbnailCanvas.height = thumbSize;
        const thumbCtx = thumbnailCanvas.getContext('2d');

        // Draw image cropped to square
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;
        thumbCtx.drawImage(img, sx, sy, minDim, minDim, 0, 0, thumbSize, thumbSize);

        const thumbnailUrl = thumbnailCanvas.toDataURL('image/jpeg', 0.8);

        this.images.push({
            img: img,
            id: imageId,
            thumbnailUrl: thumbnailUrl
        });

        // If this is the first image, set it as current (this will update views)
        if (this.images.length === 1) {
            this.setCurrentImage(0);
        } else {
            this.updateStackedView();
            if (this.isGalleryExpanded) this.updateExpandedView();
        }

        console.log(`Image added. Total images: ${this.images.length}`);
    }

    // Remove image by index
    removeImage(index) {
        if (index < 0 || index >= this.images.length) return;

        this.images.splice(index, 1);

        // Adjust current index if needed
        if (this.images.length === 0) {
            this.currentImageIndex = 0;
            this.originalImage = null;
            this.pixelCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            const dropZone = document.getElementById('dropZone');
            if (dropZone) dropZone.classList.remove('has-image');
        } else {
            if (this.currentImageIndex >= this.images.length) {
                this.currentImageIndex = this.images.length - 1;
            }
            this.setCurrentImage(this.currentImageIndex);
        }

        this.updateStackedView();
        this.updateExpandedView();

        console.log(`Image removed. Total images: ${this.images.length}`);
    }

    // Set current active image
    setCurrentImage(index) {
        if (index < 0 || index >= this.images.length) return;

        this.currentImageIndex = index;
        this.originalImage = this.images[index].img;
        this.setupCanvas(this.originalImage);
        this.processImage();

        const dropZone = document.getElementById('dropZone');
        if (dropZone) dropZone.classList.add('has-image');

        this.updateStackedView();
        this.updateExpandedView();
    }

    // Update stacked thumbnail view (mini-viewer)
    updateStackedView() {
        const container = document.getElementById('miniViewerStack');
        if (!container) return;

        container.innerHTML = '';

        if (this.images.length === 0) {
            container.style.display = 'none';
            const miniViewer = document.getElementById('miniViewer');
            if (miniViewer) {
                miniViewer.style.display = 'none';
                miniViewer.classList.remove('visible');
            }
            return;
        }

        // Hide stack when expanded gallery is open — openGallery sets display:none inline,
        // but this method is called from many places and must not clobber that state.
        container.style.display = this.isGalleryExpanded ? 'none' : 'block';
        const miniViewer = document.getElementById('miniViewer');
        if (miniViewer) {
            miniViewer.style.display = 'block';
            miniViewer.classList.add('visible');
        }

        // For single image: show only the current image (stack-0)
        // For multiple images: show up to 3 stacked (stack-0, stack-1, stack-2)
        const maxVisible = Math.min(3, this.images.length);

        // Create thumbnails (reverse order so stack-0 renders last and appears on top)
        for (let stackPosition = maxVisible - 1; stackPosition >= 0; stackPosition--) {
            // For simplicity, just show first N images in order
            const imageData = this.images[stackPosition];

            const thumb = document.createElement('div');
            thumb.className = 'stacked-thumb stack-' + stackPosition;

            thumb.innerHTML = `
                <img src="${imageData.thumbnailUrl}" alt="Image ${stackPosition + 1}">
                ${stackPosition === 0 ? '<button class="thumb-delete-btn" data-index="0">×</button>' : ''}
            `;

            container.appendChild(thumb);
        }

        // Add image count badge if more than 1 image
        if (this.images.length > 1) {
            const badge = document.createElement('div');
            badge.className = 'image-count-badge';
            badge.textContent = this.images.length;
            container.appendChild(badge);
        }

        // Add delete button listeners
        container.querySelectorAll('.thumb-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(btn.dataset.index);
                this.removeImage(index);
            });
        });

    }

    // Update expanded horizontal gallery view
    updateExpandedView() {
        const expandedImages = document.getElementById('expandedImages');
        if (!expandedImages) return;

        expandedImages.innerHTML = '';

        this.images.forEach((imageData, index) => {
            const item = document.createElement('div');
            item.className = 'expanded-thumb' + (index === this.currentImageIndex ? ' active' : '');
            item.dataset.index = index;

            item.innerHTML = `
                <img src="${imageData.thumbnailUrl}" alt="Image ${index + 1}" draggable="false">
                <button class="thumb-delete-btn" data-index="${index}">×</button>
            `;

            // Pointer-based drag — stopPropagation prevents document listener closing gallery
            item.addEventListener('pointerdown', (e) => {
                if (e.target.closest('.thumb-delete-btn')) return;
                e.stopPropagation();
                this.onGalleryPointerDown(e, index, item);
            });

            // Click to select (tap without drag)
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!e.target.closest('.thumb-delete-btn') && !this._recentlyDragged) {
                    this.setCurrentImage(index);
                }
            });

            expandedImages.appendChild(item);
        });

        // Delete button listeners
        expandedImages.querySelectorAll('.thumb-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(btn.dataset.index);
                this.removeImage(index);
            });
        });
    }

    // ── Pointer-based gallery drag (Instagram/CapCut style) ──────────────────

    onGalleryPointerDown(e, index, element) {
        // Cancel any leftover drag state from a previous interaction
        if (this._galleryMoveHandler) {
            document.removeEventListener('pointermove', this._galleryMoveHandler);
            document.removeEventListener('pointerup', this._galleryUpHandler);
            document.removeEventListener('pointercancel', this._galleryUpHandler);
        }
        if (this._galleryDragActive) this._cleanupGalleryDrag();

        this._galleryDragIndex = index;
        this._galleryDragElement = element;
        this._galleryDragStartX = e.clientX;
        this._galleryDragStartY = e.clientY;
        this._galleryDragActive = false;
        this._galleryDropIndex = undefined;

        this._galleryMoveHandler = (ev) => this.onGalleryPointerMove(ev);
        this._galleryUpHandler = (ev) => this.onGalleryPointerUp(ev);
        document.addEventListener('pointermove', this._galleryMoveHandler, { passive: false });
        document.addEventListener('pointerup', this._galleryUpHandler);
        document.addEventListener('pointercancel', this._galleryUpHandler);
    }

    onGalleryPointerMove(e) {
        e.preventDefault();
        this._ptrX = e.clientX;
        this._ptrY = e.clientY;

        if (!this._galleryDragActive) {
            const dist = Math.hypot(e.clientX - this._galleryDragStartX, e.clientY - this._galleryDragStartY);
            if (dist < 8) return;
            this._activateGalleryDrag(e);
            return;
        }

        // Throttle DOM writes to one per animation frame
        if (!this._rafPending) {
            this._rafPending = true;
            requestAnimationFrame(() => {
                this._rafPending = false;
                if (!this._galleryDragActive) return;

                // Move clone via transform — no layout reflow
                this._galleryClone.style.transform =
                    `translate3d(${this._ptrX - this._galleryCloneHalfW}px,${this._ptrY - this._galleryCloneHalfH}px,0) scale(1.08)`;

                // Only update card positions when the target slot changes
                const newDrop = this._computeGalleryDrop(this._ptrX);
                if (newDrop !== this._galleryDropIndex) {
                    this._galleryDropIndex = newDrop;
                    this._applyGalleryGap(newDrop);
                }
            });
        }
    }

    _activateGalleryDrag(e) {
        this._galleryDragActive = true;
        const el = this._galleryDragElement;
        const rect = el.getBoundingClientRect();
        this._galleryCloneHalfW = rect.width / 2;
        this._galleryCloneHalfH = rect.height / 2;

        // Clone anchored at origin, moved entirely via transform (GPU composited, no reflow)
        const clone = document.createElement('div');
        clone.className = 'expanded-thumb gallery-drag-clone';
        clone.style.cssText = [
            'position:fixed',
            'left:0',
            'top:0',
            `width:${rect.width}px`,
            `height:${rect.height}px`,
            `transform:translate3d(${e.clientX - rect.width / 2}px,${e.clientY - rect.height / 2}px,0) scale(1.08)`,
            'z-index:9999',
            'pointer-events:none',
            'opacity:0.92',
            'will-change:transform',
            'box-shadow:0 10px 30px rgba(0,0,0,0.7)',
            'border-color:#fff',
        ].join(';');
        clone.innerHTML = `<img src="${this.images[this._galleryDragIndex].thumbnailUrl}" alt="" draggable="false">`;
        document.body.appendChild(clone);
        this._galleryClone = clone;

        // Remove source from flex flow completely — opacity:0 kept its slot, causing a
        // permanent phantom gap AND allowing transforms to push cards on top of it.
        el.classList.add('gallery-drag-source');
        el.style.display = 'none';

        const expandedImages = document.getElementById('expandedImages');
        expandedImages?.classList.add('drag-in-progress');

        // Cache neighbours after source is removed (layout has reflowed without it).
        // offsetWidth forces the reflow synchronously so rects are correct.
        this._dragThumbs = [...expandedImages.querySelectorAll('.expanded-thumb')]
            .filter(t => t !== el);
        // Shift amount = card width only. The flex gap already provides spacing between
        // cards, so adding it again would create an oversized gap.
        this._dragSlotW = this._dragThumbs[0]?.offsetWidth ?? 70;

        // Snapshot base rects once — used by _computeGalleryDrop every frame so the
        // drop target doesn't shift under the cursor as transforms are applied.
        this._dragBaseRects = this._dragThumbs.map(t => {
            const r = t.getBoundingClientRect();
            return { cx: r.left + r.width / 2 };
        });

        this._rafPending = false;
        this._ptrX = e.clientX;
        this._ptrY = e.clientY;
    }

    _computeGalleryDrop(cursorX) {
        // Use pre-snapshotted base centres — not live rects — so the insertion point
        // doesn't move as neighbouring cards slide around during the drag.
        const rects = this._dragBaseRects;
        if (!rects) return 0;
        for (let i = 0; i < rects.length; i++) {
            if (cursorX < rects[i].cx) return i;
        }
        return rects.length;
    }

    _applyGalleryGap(dropIndex) {
        const thumbs = this._dragThumbs;
        if (!thumbs) return;
        const shift = `translate3d(${this._dragSlotW}px,0,0)`;
        thumbs.forEach((t, i) => {
            t.style.transform = i >= dropIndex ? shift : '';
        });
    }

    onGalleryPointerUp(e) {
        document.removeEventListener('pointermove', this._galleryMoveHandler);
        document.removeEventListener('pointerup', this._galleryUpHandler);
        document.removeEventListener('pointercancel', this._galleryUpHandler);
        this._galleryMoveHandler = null;
        this._galleryUpHandler = null;

        if (!this._galleryDragActive) {
            // Plain tap — click handler already handles selection, nothing to do
            this._galleryDragIndex = undefined;
            this._galleryDragElement = null;
            return;
        }

        if (this._galleryDropIndex !== undefined) {
            const from = this._galleryDragIndex;
            const to   = this._galleryDropIndex; // index in remaining N-1 cards

            const moved = this.images.splice(from, 1)[0];
            this.images.splice(to, 0, moved);

            let ci = this.currentImageIndex;
            if (from === ci) {
                ci = to;
            } else {
                if (from < ci) ci--;
                if (to <= ci) ci++;
            }
            this.currentImageIndex = ci;

            this._recentlyDragged = true;
            setTimeout(() => { this._recentlyDragged = false; }, 150);
        }

        this._cleanupGalleryDrag();
    }

    _cleanupGalleryDrag() {
        if (this._galleryClone) { this._galleryClone.remove(); this._galleryClone = null; }
        if (this._galleryDragElement) {
            // Restore display before DOM rebuild so the element isn't briefly invisible
            this._galleryDragElement.style.display = '';
            this._galleryDragElement.classList.remove('gallery-drag-source');
            this._galleryDragElement = null;
        }
        document.querySelectorAll('#expandedImages .expanded-thumb').forEach(t => {
            t.style.transform = '';
        });
        document.getElementById('expandedImages')?.classList.remove('drag-in-progress');
        this._galleryDragActive = false;
        this._galleryDragIndex = undefined;
        this._galleryDropIndex = undefined;
        this._dragThumbs = null;
        this._dragBaseRects = null;
        this._dragSlotW = undefined;
        this._rafPending = false;

        this.updateStackedView();
        this.updateExpandedView();
    }

    toggleGalleryExpand() {
        if (this.isGalleryExpanded) {
            this.closeGallery();
        } else {
            this.openGallery();
        }
    }

    openGallery() {
        if (this.images.length === 0) return;

        this.isGalleryExpanded = true;
        // Explicitly hide the stack — the CSS `.mini-viewer.expanded .mini-viewer-stack`
        // rule is overridden by the inline display:block set in updateStackedView, so we
        // must also set the inline style directly here.
        const stack = document.getElementById('miniViewerStack');
        if (stack) stack.style.display = 'none';

        const expanded = document.getElementById('miniViewerExpanded');
        if (expanded) {
            expanded.style.display = 'flex';
            this.updateExpandedView();
        }
        document.getElementById('miniViewer')?.classList.add('expanded');
    }

    closeGallery() {
        this.isGalleryExpanded = false;
        const expanded = document.getElementById('miniViewerExpanded');
        if (expanded) expanded.style.display = 'none';

        // Restore stack visibility
        const stack = document.getElementById('miniViewerStack');
        if (stack && this.images.length > 0) stack.style.display = 'block';

        document.getElementById('miniViewer')?.classList.remove('expanded');
    }

    // Advance to next image in sequence (for animation)
    advanceToNextImage() {
        if (this.images.length <= 1) return false;

        const nextIndex = (this.currentImageIndex + 1) % this.images.length;

        // Reset animation state
        this.animationStartTime = performance.now();
        this.motionAnimationFrame = 0;
        this.lastWaveCycle = -1;
        this.lastCycleNumber = -1;
        this._impulseCycle = -1;
        this._glitchCycle = -1;
        this._randomStartPhase = Math.random();
        this._randomPeaks = Math.floor(Math.random() * 3) + 1;

        this.currentImageIndex = nextIndex;
        this.originalImage = this.images[nextIndex].img;

        // Clear visible canvas immediately so the outgoing frame's pixels don't
        // linger for even one rAF tick while setupCanvas/prepareMotionBarOrder run.
        this.pixelCtx.clearRect(0, 0, this.pixelCanvas.width, this.pixelCanvas.height);

        this.setupCanvas(this.originalImage); // draws raw image into this.ctx for sampling

        if (this.motionAnimationRunning) {
            // During animation: just prepare bar metadata and start with a clean canvas.
            // Calling processImage() here would paint every bar at once, causing a
            // one-frame full-image flash before the animation builds up from zero.
            this.prepareMotionBarOrder();
            this.clearCanvasBackground();
        } else {
            this.processImage();
            this.prepareMotionBarOrder();
        }

        this.updateStackedView();

        if (this.motionAnimationRunning) {
            this.scheduleNextFrame();
        }

        return true;
    }

    // ===========================================
    // CRITICAL: Isolated Upload System
    // This is completely decoupled from other features
    // ===========================================
    initializeUploadSystem() {
        try {
            const fileInput = document.getElementById('fileInput');
            const uploadBtn = document.getElementById('uploadBtn');
            const dropZone = document.getElementById('dropZone');
            const mainContent = document.querySelector('.main-content');

            if (!fileInput) {
                console.error('CRITICAL: fileInput element not found');
                return;
            }

            // Enable multiple file selection
            fileInput.setAttribute('multiple', 'true');

            // Upload button click - wrapped in try-catch
            if (uploadBtn) {
                uploadBtn.addEventListener('click', (e) => {
                    try {
                        e.preventDefault();
                        e.stopPropagation();
                        fileInput.click();
                    } catch (err) {
                        console.error('Upload button error:', err);
                    }
                });
            }

            // File input change - the core upload handler (now supports multiple)
            fileInput.addEventListener('change', (e) => {
                try {
                    const files = e.target.files;
                    if (files && files.length > 0) {
                        for (let i = 0; i < files.length; i++) {
                            this.safeHandleFileSelect(files[i]);
                        }
                    }
                    // Reset file input so same files can be re-selected
                    fileInput.value = '';
                } catch (err) {
                    console.error('File input change error:', err);
                    alert('Error selecting file. Please try again.');
                }
            });

            // Mobile upload - click on main content area
            if (mainContent) {
                mainContent.addEventListener('click', (e) => {
                    try {
                        const isMobile = window.innerWidth <= 768;
                        // Only trigger if clicking on drop zone area and no images loaded
                        if (isMobile && this.images.length === 0 && e.target.closest('#dropZone')) {
                            fileInput.click();
                        }
                    } catch (err) {
                        console.error('Mobile upload error:', err);
                    }
                });
            }

            // Drag and drop events (now supports multiple files)
            if (dropZone) {
                dropZone.addEventListener('dragover', (e) => {
                    try {
                        e.preventDefault();
                        dropZone.classList.add('dragover');
                    } catch (err) {
                        console.error('Dragover error:', err);
                    }
                });

                dropZone.addEventListener('dragleave', () => {
                    try {
                        dropZone.classList.remove('dragover');
                    } catch (err) {
                        console.error('Dragleave error:', err);
                    }
                });

                dropZone.addEventListener('drop', (e) => {
                    try {
                        e.preventDefault();
                        dropZone.classList.remove('dragover');
                        const files = e.dataTransfer && e.dataTransfer.files;
                        if (files && files.length > 0) {
                            for (let i = 0; i < files.length; i++) {
                                if (this.isValidImageFile(files[i])) {
                                    this.safeHandleFileSelect(files[i]);
                                }
                            }
                        }
                    } catch (err) {
                        console.error('Drop error:', err);
                        alert('Error processing dropped file. Please try again.');
                    }
                });
            }

            console.log('Upload system initialized successfully');
        } catch (err) {
            console.error('CRITICAL: Failed to initialize upload system:', err);
        }
    }

    // Safe file handler with comprehensive error handling
    safeHandleFileSelect(file) {
        try {
            if (!file) {
                console.error('No file provided');
                return;
            }

            if (!this.isValidImageFile(file)) {
                alert('Please select a valid image file (PNG, JPG, or WebP)');
                return;
            }

            const reader = new FileReader();

            reader.onerror = (err) => {
                console.error('FileReader error:', err);
                alert('Error reading file. Please try again.');
            };

            reader.onload = (e) => {
                try {
                    const img = new Image();

                    img.onerror = () => {
                        console.error('Image load error');
                        alert('Error loading image. Please try a different file.');
                    };

                    img.onload = () => {
                        try {
                            // Add to multi-image array instead of replacing
                            this.addImage(img);

                            console.log('Image loaded successfully:', img.width, 'x', img.height);
                        } catch (err) {
                            console.error('Error processing loaded image:', err);
                            alert('Error processing image. Please try again.');
                        }
                    };

                    img.src = e.target.result;
                } catch (err) {
                    console.error('Error in reader onload:', err);
                    alert('Error processing file. Please try again.');
                }
            };

            reader.readAsDataURL(file);
        } catch (err) {
            console.error('Error in safeHandleFileSelect:', err);
            alert('Error handling file. Please try again.');
        }
    }

    // Safe slider update that won't break other functionality
    safeUpdateSliderValues() {
        try {
            const elements = {
                sizeValue: document.getElementById('sizeValue'),
                sizeSlider: document.getElementById('sizeSlider'),
                thresholdValue: document.getElementById('thresholdValue'),
                thresholdSlider: document.getElementById('thresholdSlider'),
                stretchValue: document.getElementById('stretchValue'),
                stretchSlider: document.getElementById('stretchSlider'),
                sensitivityValue: document.getElementById('sensitivityValue'),
                sensitivitySlider: document.getElementById('sensitivitySlider'),
                opacityValue: document.getElementById('opacityValue'),
                opacitySlider: document.getElementById('opacitySlider')
            };

            if (elements.sizeValue && elements.sizeSlider) {
                elements.sizeValue.textContent = elements.sizeSlider.value;
            }
            if (elements.thresholdValue && elements.thresholdSlider) {
                elements.thresholdValue.textContent = elements.thresholdSlider.value;
            }
            if (elements.stretchValue && elements.stretchSlider) {
                elements.stretchValue.textContent = elements.stretchSlider.value.padStart(2, '0');
            }
            if (elements.sensitivityValue && elements.sensitivitySlider) {
                elements.sensitivityValue.textContent = elements.sensitivitySlider.value;
            }
            if (elements.opacityValue && elements.opacitySlider) {
                elements.opacityValue.textContent = elements.opacitySlider.value;
            }
        } catch (err) {
            console.warn('Error updating slider values:', err);
        }
    }

    initializeEventListeners() {
        // File input and drag & drop - REMOVED (now in initializeUploadSystem)

        // Background removal toggle
        this.safeAddEventListener('backgroundRemovalBtn', 'click', () => this.toggleBackgroundRemoval());

        // Background image toggle
        this.safeAddEventListener('backgroundImageBtn', 'click', () => this.toggleBackgroundImage());

        // Sensitivity slider
        this.safeAddEventListener('sensitivitySlider', 'input', (e) => {
            const valueEl = document.getElementById('sensitivityValue');
            if (valueEl) valueEl.textContent = e.target.value;
            this.processImage();
            this.saveCurrentSettings();
        });

        // Opacity slider
        this.safeAddEventListener('opacitySlider', 'input', (e) => {
            const valueEl = document.getElementById('opacityValue');
            if (valueEl) valueEl.textContent = e.target.value;
            if (this.backgroundImageEnabled) {
                this.processImage();
            }
            this.saveCurrentSettings();
        });

        // Size slider
        this.safeAddEventListener('sizeSlider', 'input', (e) => {
            const valueEl = document.getElementById('sizeValue');
            if (valueEl) valueEl.textContent = e.target.value;
            this.processImage();
            this.saveCurrentSettings();
        });

        // Threshold slider
        this.safeAddEventListener('thresholdSlider', 'input', (e) => {
            const valueEl = document.getElementById('thresholdValue');
            if (valueEl) valueEl.textContent = e.target.value;
            this.processImage();
            this.saveCurrentSettings();
        });

        // Stretch slider
        this.safeAddEventListener('stretchSlider', 'input', (e) => {
            const valueEl = document.getElementById('stretchValue');
            if (valueEl) valueEl.textContent = e.target.value.padStart(2, '0');
            this.processImage();
            this.saveCurrentSettings();
        });

        // Download buttons
        this.safeAddEventListener('pngDownloadBtn', 'click', () => this.downloadPNG());

        // Reset Settings button
        this.safeAddEventListener('resetSettingsBtn', 'click', () => this.resetSettings());

        // Start/Stop Animation button
        this.safeAddEventListener('startStopMotionBtn', 'click', () => this.toggleMotionAnimation());

        // Motion type selector
        this.safeAddEventListener('motionTypeSelect', 'change', (e) => {
            this.setMotionType(e.target.value);
            this.saveCurrentSettings();
        });

        // Aspect ratio selector
        this.safeAddEventListener('aspectRatioSelect', 'change', (e) => {
            this.setAspectRatio(e.target.value);
            this.saveCurrentSettings();
        });

        // Speed slider for animation
        this.safeAddEventListener('speedSlider', 'input', (e) => {
            this.animationSpeed = parseFloat(e.target.value);
            const valueEl = document.getElementById('speedValue');
            if (valueEl) valueEl.textContent = `${this.animationSpeed.toFixed(1)}x`;
            this.saveCurrentSettings();
        });

        // Download Video button
        this.safeAddEventListener('videoDownloadBtn', 'click', () => this.downloadMotionVideo());

        // Background color controls
        this.safeAddEventListener('backgroundColorBtn', 'click', () => this.toggleBackgroundColor());
        this.safeAddEventListener('hexColorInput', 'input', (e) => {
            this.updateBackgroundColor(e.target.value);
            this.saveCurrentSettings();
        });
        this.safeAddEventListener('hexColorInput', 'change', (e) => {
            this.updateBackgroundColor(e.target.value);
            this.saveCurrentSettings();
        });

        // Color wheel controls
        this.safeAddEventListener('colorPreview', 'click', () => this.toggleColorWheel());
        this.safeAddEventListener('closeColorWheel', 'click', () => this.closeColorWheel());

        // Close color wheel when clicking outside
        document.addEventListener('click', (e) => {
            try {
                const colorWheel = document.getElementById('colorWheelPopup');
                const colorPreview = document.getElementById('colorPreview');
                if (colorWheel && colorPreview &&
                    colorWheel.style.display === 'block' &&
                    !colorWheel.contains(e.target) &&
                    !colorPreview.contains(e.target)) {
                    this.closeColorWheel();
                }
            } catch (err) {
                console.warn('Color wheel close error:', err);
            }
        });

        // Reverse mask control
        this.safeAddEventListener('reverseMaskBtn', 'click', () => this.toggleReverseMask());
    }

    // Helper method to safely add event listeners
    safeAddEventListener(elementId, event, handler) {
        try {
            const element = document.getElementById(elementId);
            if (element) {
                element.addEventListener(event, (e) => {
                    try {
                        handler(e);
                    } catch (err) {
                        console.warn(`Error in ${elementId} ${event} handler:`, err);
                    }
                });
            } else {
                console.warn(`Element not found: ${elementId}`);
            }
        } catch (err) {
            console.warn(`Error adding listener to ${elementId}:`, err);
        }
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
        
        // Reset impulse origins so next cycle picks new positions
        this._impulseCycle = -1;
        
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
        this.animationStartTime = performance.now();
        this._impulseCycle = -1;
        this._glitchCycle = -1;
        this.lastWaveCycle = -1;
        this.lastCycleNumber = -1;
        this._randomStartPhase = Math.random();
        this._randomPeaks = Math.floor(Math.random() * 3) + 1;
        this.runMotionAnimation();
    }

    stopMotionAnimation() {
        this.motionAnimationRunning = false;
        document.getElementById('startStopMotionBtn').textContent = window.innerWidth <= 768 ? 'START' : 'START ANIMATION';
        if (this.motionAnimationRequestId) {
            cancelAnimationFrame(this.motionAnimationRequestId);
            this.motionAnimationRequestId = null;
        }

        // Note: Recording continues independently, user must click video button to stop

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

        // Calculate exact bar counts so bars tile perfectly to all edges (same as pixelateImage)
        const numBarsHorizontally = Math.max(1, Math.round(width / pixelSize));
        const numBarsVertically = Math.max(1, Math.round(height / desiredBarHeight));

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
        for (let col = 0; col < numBarsHorizontally; col++) {
            const x = Math.round(col * width / numBarsHorizontally);
            const actualBarWidth = Math.round((col + 1) * width / numBarsHorizontally) - x;
            for (let row = 0; row < numBarsVertically; row++) {
                const y = Math.round(row * height / numBarsVertically);
                const actualBarHeight = Math.round((row + 1) * height / numBarsVertically) - y;
                // Sample a point in this area (same logic as in pixelateImage)
                const sampleX = Math.min(x + Math.floor(actualBarWidth / 2), width - 1);
                const sampleY = Math.min(y + Math.floor(actualBarHeight / 2), height - 1);
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
                        width: actualBarWidth,
                        height: actualBarHeight
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
            case 'motion3':
                this.runMotion3Animation();
                break;
            case 'motion4':
                this.runMotion4Animation();
                break;
            case 'motion5':
                this.runMotion5Animation();
                break;
            case 'motion6':
                this.runMotion6Animation();
                break;
            case 'motion7':
                this.runMotion7Animation();
                break;
            default:
                this.runMotion1Animation();
        }
    }

    runMotion1Animation() {
        this.clearCanvasBackground();

        const elapsedTime = performance.now() - this.animationStartTime;
        const cycleDuration = this.baseCycleDuration / this.animationSpeed;
        const currentCycleNumber = Math.floor(elapsedTime / cycleDuration);
        if (this.checkCycleAdvance(currentCycleNumber)) return;

        const halfCycleDuration = cycleDuration / 2;
        const timeInCycle = elapsedTime % cycleDuration;

        let visibleBarCount;
        if (timeInCycle < halfCycleDuration) {
            visibleBarCount = Math.floor((timeInCycle / halfCycleDuration) * this.motionBarOrder.length);
        } else {
            const downProgress = (timeInCycle - halfCycleDuration) / halfCycleDuration;
            visibleBarCount = Math.floor((1 - downProgress) * this.motionBarOrder.length);
        }

        for (let i = 0; i < visibleBarCount; i++) {
            this.drawBar(this.motionBarOrder[i]);
        }

        this.updateDisplay();
        this.motionAnimationFrame++;
        this.scheduleNextFrame();
    }

    runMotion3Animation() {
        this.clearCanvasBackground();

        const elapsedTime = performance.now() - this.animationStartTime;
        const cycleDuration = this.baseCycleDuration / this.animationSpeed;
        const currentCycleNumber = Math.floor(elapsedTime / cycleDuration);
        if (this.checkCycleAdvance(currentCycleNumber)) return;

        // Re-roll origins once per cycle — seeded LCG so positions are stable within
        // a cycle but change every cycle.
        if (this._impulseCycle !== currentCycleNumber) {
            this._impulseCycle = currentCycleNumber;
            let s = (currentCycleNumber * 1664525 + 1013904223) >>> 0;
            const rng = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0xFFFFFFFF; };
            const w = this.canvas.width, h = this.canvas.height;
            this._impulseOrigins = [
                { x: w * (0.15 + rng() * 0.7), y: h * (0.15 + rng() * 0.7), offset: 0 },
                { x: w * (0.15 + rng() * 0.7), y: h * (0.15 + rng() * 0.7), offset: 0.38 + rng() * 0.18 },
            ];
            this._impulseMaxR = Math.sqrt(w * w + h * h);
        }

        const phase = (elapsedTime % cycleDuration) / cycleDuration; // 0 → 1
        const maxR = this._impulseMaxR;
        const coreW = maxR * 0.13; // solid ring width — deterministic, no per-frame randomness

        for (const bar of this.motionBarOrder) {
            let draw = false;
            for (const o of this._impulseOrigins) {
                const p = (phase + o.offset) % 1;
                // Ease-out expansion: ring starts fast and slows toward edges
                const r    = maxR * (1 - Math.pow(1 - p, 1.6));
                const dist = Math.sqrt((bar.x - o.x) ** 2 + (bar.y - o.y) ** 2);
                if (Math.abs(dist - r) <= coreW) { draw = true; break; }
            }
            if (draw) this.drawBar(bar);
        }

        this.updateDisplay();
        this.motionAnimationFrame++;
        this.scheduleNextFrame();
    }

    runMotion4Animation() {
        const elapsedTime = performance.now() - this.animationStartTime;
        const cycleDuration = this.baseCycleDuration / this.animationSpeed;
        const currentCycle = Math.floor(elapsedTime / cycleDuration);
        const timeInCycle = elapsedTime % cycleDuration;

        if (this.checkCycleAdvance(currentCycle)) return;

        if (this.lastWaveCycle !== currentCycle) {
            this.lastWaveCycle = currentCycle;
            this.waveDirection = Math.floor(Math.random() * 4);
            this.sortBarsBy(this.waveDirection);
        }

        this.clearCanvasBackground();

        const rawProgress = timeInCycle / cycleDuration;
        const progress = rawProgress < 0.5
            ? 2 * rawProgress * rawProgress
            : 1 - Math.pow(-2 * rawProgress + 2, 3) / 2;

        const totalBars = this.motionBarOrder.length;

        if (progress <= 0.5) {
            const barsToShow = Math.floor(totalBars * progress * 2);
            for (let i = 0; i < barsToShow; i++) this.drawBar(this.motionBarOrder[i]);
        } else {
            const barsToHide = Math.floor(totalBars * (progress - 0.5) * 2);
            for (let i = barsToHide; i < totalBars; i++) this.drawBar(this.motionBarOrder[i]);
        }

        this.updateDisplay();
        this.motionAnimationFrame++;
        this.scheduleNextFrame();
    }

    runMotion5Animation() {
        const elapsedTime = performance.now() - this.animationStartTime;
        const cycleDuration = this.baseCycleDuration / this.animationSpeed;
        const currentCycle = Math.floor(elapsedTime / cycleDuration);
        const timeInCycle = elapsedTime % cycleDuration;

        if (this.checkCycleAdvance(currentCycle)) return;

        if (this.fadeDirection === undefined) {
            this.fadeDirection = Math.floor(Math.random() * 4);
            this.sortBarsBy(this.fadeDirection);
        }

        this.pixelCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        if (this.originalImage) {
            this.pixelCtx.globalAlpha = 1.0;
            this.pixelCtx.globalCompositeOperation = 'source-over';
            this.drawOriginalImageToContext(this.pixelCtx);
        }

        // Step 2: Create a temporary canvas for the mask
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = this.canvas.width;
        maskCanvas.height = this.canvas.height;
        const maskCtx = maskCanvas.getContext('2d');

        // Fill mask with hex color overlay
        const overlayColor = this.backgroundColorEnabled ? this.backgroundColor : '#000000';
        maskCtx.fillStyle = overlayColor;
        maskCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Step 3: Cut out holes in the mask where bars should be visible
        const rawProgress = timeInCycle / cycleDuration;
        const totalBars = this.motionBarOrder.length;

        maskCtx.globalCompositeOperation = 'destination-out';

        // Two phase animation: fade in, then fade out
        if (rawProgress <= 0.5) {
            // FADE IN phase: bars become windows (reveal image)
            const fadeInProgress = rawProgress * 2; // 0 to 1
            
            for (let i = 0; i < totalBars; i++) {
                const bar = this.motionBarOrder[i];
                const barPosition = i / totalBars;
                
                // Calculate opacity: how much of the hex overlay to remove
                let cutoutOpacity;
                if (barPosition <= fadeInProgress) {
                    // Wave has passed - fully visible (fully cut out)
                    cutoutOpacity = 1.0;
                } else if (barPosition <= fadeInProgress + 0.2) {
                    // In the wave zone - transitioning
                    const transitionProgress = (barPosition - fadeInProgress) / 0.2;
                    cutoutOpacity = 1.0 - transitionProgress; // Fade from 1.0 to 0
                } else {
                    // Wave hasn't reached yet - not visible (skip)
                    continue;
                }
                
                // Cut out the overlay to reveal the image
                maskCtx.globalAlpha = cutoutOpacity;
                maskCtx.fillStyle = '#FFFFFF'; // Color doesn't matter for destination-out
                maskCtx.fillRect(bar.x, bar.y, bar.width, bar.height);
            }
        } else {
            // FADE OUT phase: bars close back up (hide image, show hex color)
            const fadeOutProgress = (rawProgress - 0.5) * 2; // 0 to 1
            
            for (let i = 0; i < totalBars; i++) {
                const bar = this.motionBarOrder[i];
                const barPosition = i / totalBars;
                
                // Calculate opacity: how much of the hex overlay to remove
                let cutoutOpacity;
                if (barPosition <= fadeOutProgress) {
                    // Wave has passed - closed (skip, hex color stays)
                    continue;
                } else if (barPosition <= fadeOutProgress + 0.2) {
                    // In the wave zone - transitioning
                    const transitionProgress = (barPosition - fadeOutProgress) / 0.2;
                    cutoutOpacity = transitionProgress; // Fade from 0 to 1.0
                } else {
                    // Wave hasn't reached yet - fully visible
                    cutoutOpacity = 1.0;
                }
                
                // Cut out the overlay to reveal the image
                maskCtx.globalAlpha = cutoutOpacity;
                maskCtx.fillStyle = '#FFFFFF';
                maskCtx.fillRect(bar.x, bar.y, bar.width, bar.height);
            }
        }

        // Step 4: Draw the mask on top of the original image
        this.pixelCtx.globalAlpha = 1.0;
        this.pixelCtx.globalCompositeOperation = 'source-over';
        this.pixelCtx.drawImage(maskCanvas, 0, 0);

        this.updateDisplay();
        this.motionAnimationFrame++;
        this.scheduleNextFrame();
    }

    runMotion6Animation() {
        const elapsedTime = performance.now() - this.animationStartTime;
        const cycleDuration = this.baseCycleDuration / this.animationSpeed;
        const currentCycle = Math.floor(elapsedTime / cycleDuration);

        if (this.checkCycleAdvance(currentCycle)) return;

        // Reshuffle once per cycle using LCG + Fisher-Yates
        // (sort-with-sin breaks at seed=0 since sin(0)=0 for every term)
        if (this._glitchCycle !== currentCycle) {
            this._glitchCycle = currentCycle;
            this._glitchBars = [...this.motionBarOrder];
            let s = (currentCycle * 1664525 + 1013904223) >>> 0;
            const rng = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0xFFFFFFFF; };
            for (let i = this._glitchBars.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [this._glitchBars[i], this._glitchBars[j]] = [this._glitchBars[j], this._glitchBars[i]];
            }
        }

        this.clearCanvasBackground();
        const total = this._glitchBars.length;
        if (total === 0) { this.scheduleNextFrame(); return; }

        const rawProgress = (elapsedTime % cycleDuration) / cycleDuration;

        if (rawProgress < 0.5) {
            const target = Math.floor(total * rawProgress * 2);
            for (let i = 0; i < target; i++) this.drawBar(this._glitchBars[i]);
            for (let i = target; i < Math.min(target + 8, total); i++) {
                if (Math.random() > 0.6) this.drawBar(this._glitchBars[i]);
            }
        } else {
            const hidden = Math.floor(total * (rawProgress - 0.5) * 2);
            for (let i = hidden; i < total; i++) this.drawBar(this._glitchBars[i]);
            for (let i = Math.max(0, hidden - 8); i < hidden; i++) {
                if (Math.random() > 0.7) this.drawBar(this._glitchBars[i]);
            }
        }

        this.updateDisplay();
        this.motionAnimationFrame++;
        this.scheduleNextFrame();
    }

    runMotion7Animation() {
        const elapsedTime = performance.now() - this.animationStartTime;
        const cycleDuration = this.baseCycleDuration / this.animationSpeed;
        const currentCycle = Math.floor(elapsedTime / cycleDuration);

        if (this.checkCycleAdvance(currentCycle)) return;

        this.clearCanvasBackground();
        const total = this.motionBarOrder.length;
        if (total === 0) { this.scheduleNextFrame(); return; }

        // Phase starts at a random offset each run so no two starts look the same.
        // _randomPeaks (1–3) controls how many pulses fire per cycle.
        const phase = ((elapsedTime % cycleDuration) / cycleDuration + this._randomStartPhase) % 1;
        const density = Math.pow(Math.sin(phase * Math.PI * this._randomPeaks), 2);

        for (const bar of this.motionBarOrder) {
            if (Math.random() < density) this.drawBar(bar);
        }

        this.updateDisplay();
        this.motionAnimationFrame++;
        this.scheduleNextFrame();
    }

    drawBar(bar) {
        if (this.reverseMaskEnabled && this.originalImage) {
            this.pixelCtx.save();
            this.pixelCtx.beginPath();
            this.pixelCtx.rect(bar.x, bar.y, bar.width, bar.height);
            this.pixelCtx.clip();
            this.drawOriginalImageToContext(this.pixelCtx);
            this.pixelCtx.restore();
        } else {
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
        this.motionAnimationRequestId = requestAnimationFrame(() => this.runMotionAnimation());
    }

    clearCanvasBackground() {
        const { width, height } = this.canvas;
        this.pixelCtx.clearRect(0, 0, width, height);
        if (this.backgroundColorEnabled) {
            this.pixelCtx.fillStyle = this.backgroundColor;
            this.pixelCtx.fillRect(0, 0, width, height);
        }
        if (this.backgroundImageEnabled && this.originalImage) {
            const opacity = parseInt(document.getElementById('opacitySlider').value) / 100;
            this.pixelCtx.globalAlpha = opacity;
            this.drawOriginalImageToContext(this.pixelCtx);
            this.pixelCtx.globalAlpha = 1.0;
        }
    }

    checkCycleAdvance(currentCycle) {
        if (this.images.length > 1 && currentCycle > this.lastCycleNumber) {
            this.lastCycleNumber = currentCycle;
            if (currentCycle > 0) {
                this.advanceToNextImage();
                return true;
            }
        }
        return false;
    }

    sortBarsBy(direction) {
        this.motionBarOrder.sort((a, b) => {
            switch (direction) {
                case 0: return a.x - b.x;
                case 1: return b.x - a.x;
                case 2: return a.y - b.y;
                case 3: return b.y - a.y;
                default: return 0;
            }
        });
    }

    updateToggleBtn(enabled, btnId, desktopLabel, cardId = null) {
        const btn = document.getElementById(btnId);
        const isMobile = window.innerWidth <= 768;
        btn.textContent = isMobile ? (enabled ? 'ON' : 'OFF') : `${desktopLabel}: ${enabled ? 'ON' : 'OFF'}`;
        btn.classList.toggle('active', enabled);
        if (cardId) document.getElementById(cardId).style.display = enabled ? 'block' : 'none';
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

    detectVideoFormat() {
        const candidates = [
            { mimeType: 'video/webm;codecs=vp9', bps: 8000000 },
            { mimeType: 'video/webm;codecs=vp8', bps: 6000000 },
            { mimeType: 'video/webm',             bps: 5000000 },
            { mimeType: 'video/mp4;codecs=h264',  bps: 10000000 },
            { mimeType: 'video/mp4',              bps: 10000000 },
        ];
        for (const c of candidates) {
            if (MediaRecorder.isTypeSupported(c.mimeType)) {
                return { mimeType: c.mimeType, videoBitsPerSecond: c.bps };
            }
        }
        return null;
    }

    async startVideoRecording() {
        try {
            if (this.isRecording) return;

            if (typeof MediaRecorder === 'undefined') {
                alert('Video recording is not supported in this browser.\nPlease use Chrome, Firefox, or Safari 14.1+.');
                return;
            }

            const finalWidth = this.pixelCanvas.width;
            const finalHeight = this.pixelCanvas.height;

            this.videoCanvas = document.createElement('canvas');
            this.videoCanvas.width = finalWidth;
            this.videoCanvas.height = finalHeight;
            this.videoCtx = this.videoCanvas.getContext('2d');

            if (typeof this.videoCanvas.captureStream !== 'function') {
                alert('Canvas video capture is not supported in this browser.\nPlease use Chrome, Firefox, or Safari 14.1+.');
                return;
            }

            this.videoStream = this.videoCanvas.captureStream(30);

            const options = this.detectVideoFormat();
            if (!options) {
                alert('No supported video format found in this browser.\nPlease try Chrome or Firefox.');
                return;
            }

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
            const totalSize = this.recordedChunks.reduce((sum, chunk) => sum + chunk.size, 0);
            if (totalSize === 0) throw new Error('Video data is empty');

            const mimeType = (this.mediaRecorder && this.mediaRecorder.mimeType) || 'video/webm';
            const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
            const blob = new Blob(this.recordedChunks, { type: mimeType });
            const filename = `pixelation-animation-${Date.now()}.${extension}`;

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);

            this.resetVideoState();
            alert(`Video saved!\n\nFile: ${filename}\nSize: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);

        } catch (error) {
            alert('Failed to download video: ' + error.message);
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

    isValidImageFile(file) {
        try {
            const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
            return file && validTypes.includes(file.type);
        } catch (err) {
            console.warn('Error validating file:', err);
            return false;
        }
    }

    saveCurrentSettings() {
        const currentSettings = {
            pixelSize: parseInt(document.getElementById('sizeSlider').value),
            threshold: parseInt(document.getElementById('thresholdSlider').value),
            stretch: parseInt(document.getElementById('stretchSlider').value),
            sensitivity: parseInt(document.getElementById('sensitivitySlider').value),
            opacity: parseInt(document.getElementById('opacitySlider').value),
            motionType: document.getElementById('motionTypeSelect').value,
            speed: parseFloat(document.getElementById('speedSlider').value),
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
                
                // Sync JS state from saved values
                this.motionType = settings.motionType || this.defaultSettings.motionType;
                this.animationSpeed = parseFloat(settings.speed) || this.defaultSettings.speed;

                // Apply aspect ratio
                this.setAspectRatio(settings.aspectRatio || this.defaultSettings.aspectRatio);

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
        
        // Sync JS state back to defaults
        this.motionType = this.defaultSettings.motionType;
        this.animationSpeed = this.defaultSettings.speed;

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

    toggleBackgroundRemoval() {
        this.backgroundRemovalEnabled = !this.backgroundRemovalEnabled;
        this.updateToggleBtn(this.backgroundRemovalEnabled, 'backgroundRemovalBtn', 'REMOVE BACK', 'sensitivityCard');
        if (this.originalImage) this.processImage();
    }

    toggleBackgroundImage() {
        this.backgroundImageEnabled = !this.backgroundImageEnabled;
        this.updateToggleBtn(this.backgroundImageEnabled, 'backgroundImageBtn', 'SHOW IMAGE', 'opacityCard');
        if (this.originalImage) this.processImage();
    }

    toggleBackgroundColor() {
        this.backgroundColorEnabled = !this.backgroundColorEnabled;
        this.updateToggleBtn(this.backgroundColorEnabled, 'backgroundColorBtn', 'BACK COLOR', 'colorCard');
        if (this.originalImage) this.processImage();
    }

    updateBackgroundColor(hexValue) {
        const hex = hexValue.startsWith('#') ? hexValue : '#' + hexValue;
        if (!/^#[0-9A-F]{6}$/i.test(hex)) return;
        this.backgroundColor = hex;
        document.getElementById('hexColorInput').value = hex;
        document.getElementById('colorPreview').style.backgroundColor = hex;
        if (this.backgroundColorEnabled && this.originalImage) this.processImage();
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
        
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
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
        this.updateToggleBtn(this.reverseMaskEnabled, 'reverseMaskBtn', 'MASK');
        if (this.originalImage) this.processImage();
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
        
        this.clearCanvasBackground();
        
        // NEW APPROACH: Create vertical bars by sampling horizontally and drawing tall rectangles
        const barWidth = pixelSize; // Width of each vertical bar
        const baseBarHeight = pixelSize * 3; // Base height (always taller than width)
        const extraHeight = Math.floor(stretchFactor * 2); // Additional height based on stretch factor
        const desiredBarHeight = baseBarHeight + extraHeight;

        // Calculate exact bar counts so bars tile perfectly to all edges
        const numBarsHorizontally = Math.max(1, Math.round(width / barWidth));
        const numBarsVertically = Math.max(1, Math.round(height / desiredBarHeight));

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

        // Draw vertical bars across the image using proportional grid — no partial/bleeding bars
        for (let col = 0; col < numBarsHorizontally; col++) {
            const x = Math.round(col * width / numBarsHorizontally);
            const actualBarWidth = Math.round((col + 1) * width / numBarsHorizontally) - x;
            for (let row = 0; row < numBarsVertically; row++) {
                const y = Math.round(row * height / numBarsVertically);
                const actualBarHeight = Math.round((row + 1) * height / numBarsVertically) - y;
                // Sample a point in this area
                const sampleX = Math.min(x + Math.floor(actualBarWidth / 2), width - 1);
                const sampleY = Math.min(y + Math.floor(actualBarHeight / 2), height - 1);
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
                    this.pixelCtx.rect(x, y, actualBarWidth, actualBarHeight);
                    this.pixelCtx.clip();
                    this.drawOriginalImageToContext(this.pixelCtx);
                    this.pixelCtx.restore();
                } else {
                    // Normal mode: draw colored bar
                    this.pixelCtx.fillStyle = `rgb(${r},${g},${b})`;
                    this.pixelCtx.fillRect(x, y, actualBarWidth, actualBarHeight);
                }
            }
        }
        
        this.pixelCanvas.style.display = 'block';
        this.canvas.style.display = 'block';
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
