const App = {
    currentDriver: null,
    activeTab: 'markdown',
    lastImage: null, // Сохраняем картинку, чтобы менять отступ без повторной вставки
    
    init() {
        this.fillDrivers();
        this.bindEvents();
        this.updatePreview(); // Начальный рендер
        this.canvas = document.getElementById('mainCanvas');
        if (this.canvas) {
            this.canvas.onmousedown = (e) => {
                const pt = this.getCanvasPoint(e);
                
                const target = ImageManager.findImageAt(pt.x, pt.y);
                
                if (target) {
                    this.selectedId = target.id;
                    ImageManager.selectedId = target.id;
                    
                    this.isDragging = false; 
                    this.dragTarget = target;
                    this.dragTarget.startX = target.x;
                    this.dragTarget.startY = target.y;
                    
                    // Смещение считаем в единой системе координат холста
                    this.dragOffset = { 
                        x: pt.x - target.x, 
                        y: pt.y - target.y 
                    };
                    
                    this.updatePreview();
                    this.syncControls(target);
                    
                    const controls = document.getElementById('imgControls');
                    if (controls) controls.classList.remove('hidden');
                } else {
                    this.selectedId = null;
                    ImageManager.selectedId = null;
                    const controls = document.getElementById('imgControls');
                    if (controls) controls.classList.add('hidden');
                    this.updatePreview();
                }
            };
        }
        App.checkUrlLang();
        App.initPhotoPreview();
    },

    initPhotoPreview() {
        const btn = document.querySelector('.view-real-btn');
        const overlay = document.getElementById('realPhotoOverlay');
        const canvas = document.getElementById('mainCanvas');
        
        if (!btn || !overlay || !canvas) return;

        btn.addEventListener('mouseenter', () => {
            // Подстраиваем размеры оверлея под текущий динамический размер канваса
            overlay.style.width = `${canvas.offsetWidth}px`;
            overlay.style.height = `${canvas.offsetHeight}px`;
            
            // Центрируем относительно wrapper
            overlay.style.top = `${canvas.offsetTop}px`;
            overlay.style.left = `${canvas.offsetLeft}px`;
            
            overlay.classList.remove('hidden');
        });
        
        btn.addEventListener('mouseleave', () => {
            overlay.classList.add('hidden');
        });
    },

    fillDrivers() {
        const sel = document.getElementById('driverSelect');
        if (!sel || typeof PrinterRegistry === 'undefined') return;
        sel.innerHTML = '';
        for (let key in PrinterRegistry) {
            sel.add(new Option(PrinterRegistry[key].name, key));
        }
    },

    bindEvents() {
        // 1. Подключение
        const connectBtn = document.getElementById('connectBtn');
        if (connectBtn) {
            connectBtn.onclick = async () => {
                try {
                    const driverKey = document.getElementById('driverSelect').value;
                    this.currentDriver = PrinterRegistry[driverKey].driver;
                    const name = await this.currentDriver.connect();
                    document.getElementById('status').innerText = "🟢 " + name;
                    document.getElementById('printBtn').disabled = false;
                } catch (e) { 
                    alert("Bağlantı hatası: " + e.message); 
                }
            };
        }
        
        // 2. Печать
        const printBtn = document.getElementById('printBtn');
        if (printBtn) {
            printBtn.onclick = async () => {
                try {
                    const { bytes, height } = Renderer.getBitmapBytes();
                    printBtn.disabled = true;
                    document.getElementById('printStatus').innerText = "Yazdırılıyor...";
                    
                    await this.currentDriver.print(bytes, height);
                    
                    document.getElementById('printStatus').innerText = "Yazdırmaya hazır";
                    printBtn.disabled = false;
                } catch (e) {
                    alert("Yazdırma hatası: " + e.message);
                    printBtn.disabled = false;
                }
            };
        }
        
        // 3. Табы
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
                
                btn.classList.add('active');
                this.activeTab = btn.dataset.tab;
                const targetTab = document.getElementById(this.activeTab + '-tab');
                if (targetTab) targetTab.classList.remove('hidden');
                
                if (this.activeTab === 'markdown') {
                    const textarea = document.getElementById('textInput');
                    if (textarea) {
                        const currentVal = textarea.value;
                        textarea.value = ""; 
                        textarea.value = currentVal;
                    }
                } else if (this.activeTab === 'cargo') {
                    this.toggleCargoFields();
                }
                
                this.updatePreview();
            };
        });
        
        // 4. Инпуты и настройки
        ['textInput', 'fontSize', 'lineSpacing', 'offsetX', 'fontFamily'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.oninput = () => this.updatePreview();
        });

        window.onmousemove = (e) => {
            if (this.dragTarget) {
                const pt = this.getCanvasPoint(e);
                
                const currentX = pt.x - this.dragOffset.x;
                const currentY = pt.y - this.dragOffset.y;
                
                if (!this.isDragging && (Math.abs(currentX - this.dragTarget.startX) > 3)) {
                    this.isDragging = true;
                    this.dragTarget.mode = 1; 
                }
                
                if (this.isDragging) {
                    this.dragTarget.x = currentX;
                    this.dragTarget.y = currentY;
                    
                    this.updateObjectInText(this.dragTarget);
                    this.syncControls(this.dragTarget);
                    this.updatePreview();
                }
            }
        };
        
        window.onmouseup = () => {
            this.isDragging = false;
            this.dragTarget = null;
        };      
        
        // 5. Вставка картинки
        window.addEventListener('paste', (e) => {
            console.log("Global paste event detected!");
            this.handlePaste(e);
        }, true);
    },

    handlePaste(e) {
        if (!e.clipboardData || !e.clipboardData.items) return;
        const item = Array.from(e.clipboardData.items).find(x => x.type.indexOf('image') !== -1);
        if (!item) return;
        
        e.preventDefault();
        
        const blob = item.getAsFile();
        const imgId = `img${Object.keys(ImageManager.storage || {}).length + 1}`;
        
        console.log("Вставка картинки в текст:", imgId);
        
        ImageManager.process(blob, imgId).then(() => {
            const newTag = `[IMG:${imgId}|0|0|0|0|1.0]`;
            this.insertTagAtCursor(newTag);
            this.selectedId = imgId;
            this.syncControls({ id: imgId, mode: 0, x: 0, y: 0, rotate: 0, scale: 1.0 });
            
            const controls = document.getElementById('imgControls');
            if (controls) controls.classList.remove('hidden');
            
            ImageManager.updateUI();
            this.updatePreview(); 
            
            console.log("Картинка интегрирована в документ.");
        });
    },

async updatePreview() {
        const fontSizeEl = document.getElementById('fontSize');
        const lineSpacingEl = document.getElementById('lineSpacing');
        const offsetXEl = document.getElementById('offsetX');
        const fontFamilyEl = document.getElementById('fontFamily');
        const textInputEl = document.getElementById('textInput');

        if (!fontSizeEl || !lineSpacingEl || !offsetXEl || !fontFamilyEl || !textInputEl) return;

        const params = {
            fontSize: parseInt(fontSizeEl.value),
            lineSpacing: parseFloat(lineSpacingEl.value),
            offsetX: parseInt(offsetXEl.value),
            fontFamily: fontFamilyEl.value
        };
        
        if (typeof Renderer !== 'undefined' && Renderer.renderMarkdown) {
            await Renderer.renderMarkdown(textInputEl.value, params);
        }
        
        const vSizeEl = document.getElementById('vSize');
        const vOffsetEl = document.getElementById('vOffset');
        const vSpacingEl = document.getElementById('vSpacing');

        if (vSizeEl) vSizeEl.innerText = params.fontSize;
        if (vOffsetEl) vOffsetEl.innerText = params.offsetX;
        if (vSpacingEl) vSpacingEl.innerText = params.lineSpacing;
    },

    applyImgChanges() {
        if (!this.selectedId) return;
        
        const isFlow = document.getElementById('imgMode').checked;
        const s = parseFloat(document.getElementById('imgScale').value);
        const r = parseInt(document.getElementById('imgRotate').value);
        const x = parseInt(document.getElementById('imgOffset').value);
        
        const currentPos = Renderer.lastRenderedPositions ? Renderer.lastRenderedPositions[this.selectedId] : null;
        if (!currentPos) return;
        
        const updatedObj = {
            id: this.selectedId,
            mode: isFlow ? 0 : 1, 
            x: x,
            y: currentPos.y,
            rotate: r,
            scale: s
        };
        
        this.updateObjectInText(updatedObj);
        this.updatePreview();
    },

    syncControls(imgData) {
        document.getElementById('imgMode').checked = (imgData.mode === 0);
        document.getElementById('imgScale').value = imgData.scale || 1.0;
        document.getElementById('imgRotate').value = imgData.rotate || 0;
        document.getElementById('imgOffset').value = imgData.x || 0;
    },

    selectImage(id) {
        this.selectedId = id;
        ImageManager.selectedId = id;
        
        const pos = Renderer.lastRenderedPositions ? Renderer.lastRenderedPositions[id] : null;
        
        if (pos) {
            const imgData = {
                id: id,
                scale: pos.s,
                rotate: pos.r,
                x: pos.x,
                y: pos.y,
                mode: pos.mode
            };
            
            this.syncControls(imgData);
            
            const controls = document.getElementById('imgControls');
            if (controls) controls.classList.remove('hidden');
        } else {
            console.warn("Элемент не найден в текущем документе (в тексте)");
        }
        
        ImageManager.updateUI();
        this.updatePreview();
    },

    detachFromFlow(id, newX, newY) {
        const textarea = document.getElementById('textInput');
        if (!textarea) return;

        const rawId = id.replace(/^(qr_|code128_)/, '');
        const regex = new RegExp(`\\[(IMG|QR|CODE128):(${rawId})\\|0\\|`, 'g');

        if (regex.test(textarea.value)) {
            const roundedX = Math.round(newX);
            const roundedY = Math.round(newY);
            textarea.value = textarea.value.replace(regex, `[$1:${rawId}|1|${roundedX}|${roundedY}|`);
            this.updatePreview();
        }
    },

    updateObjectInText(obj) {
        const textarea = document.getElementById('textInput');
        if (!textarea || !obj || !obj.id) return;

        const rawId = obj.id.replace(/^(qr_|code128_)/, '');
        const regex = new RegExp(`\\[(IMG|QR|CODE128):(${rawId})(?:\\|([^\\]]*))?\\]`, 'g');

        const roundedX = Math.round(obj.x || 0);
        const roundedY = Math.round(obj.y || 0);
        const scale = obj.scale !== undefined ? obj.scale : 1.0;
        const rotate = obj.rotate || 0;
        const mode = obj.mode !== undefined ? obj.mode : 0;

        const newTag = `[$1:${rawId}|${mode}|${roundedX}|${roundedY}|${rotate}|${scale}]`;

        textarea.value = textarea.value.replace(regex, newTag);
    },

    insertTagAtCursor(tag) {
        const textarea = document.getElementById('textInput');
        if (!textarea) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        
        const before = text.substring(0, start);
        const after = text.substring(end);
        
        const prefix = (before.length > 0 && !before.endsWith('\n')) ? '\n' : '';
        const suffix = (!after.startsWith('\n')) ? '\n' : '';
        
        textarea.value = before + prefix + tag + suffix + after;
        
        textarea.focus();
        this.updatePreview();
    },

    handleFileSelect(input) {
        if (input.files && input.files[0]) {
            ImageManager.importImage(input.files[0]);
        }
    },

    promptUrl() {
        const url = prompt("Введите прямой URL картинки:");
        if (url) {
            ImageManager.importImage(url);
        }
    },

    getCanvasPoint(e) {
        if (!this.canvas) return { x: 0, y: 0 };
        const rect = this.canvas.getBoundingClientRect();
        
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    },

    setLanguage(lang, skipHistory = false) {
        const textarea = document.getElementById('textInput');
        if (lang === 'en') {
            document.body.classList.add('en-mode');
            const swEn = document.getElementById('sw-en');
            const swTr = document.getElementById('sw-tr');
            if (swEn) swEn.classList.add('active');
            if (swTr) swTr.classList.remove('active');
            if (textarea) textarea.placeholder = "Example:\n# HEADER\n [IMG:/logowb.jpg] \n [QR: mxw01.ru]...";
        } else {
            document.body.classList.remove('en-mode');
            const swTr = document.getElementById('sw-tr');
            const swEn = document.getElementById('sw-en');
            if (swTr) swTr.classList.add('active');
            if (swEn) swEn.classList.remove('active');
            if (textarea) textarea.placeholder = "Пример:\n# BAŞLIK\n[IMG:/logowb.jpg] \n[QR: mxw01.ru]...";
        }
        if (!skipHistory) {
            const newUrl = lang === 'en' ? '?lang=en' : window.location.pathname;
            window.history.pushState({ lang: lang }, '', newUrl);
        }
    },

    checkUrlLang() {
        const urlParams = new URLSearchParams(window.location.search);
        const lang = urlParams.get('lang');
        
        if (lang === 'en') {
            App.setLanguage('en', true);
        } else {
            App.setLanguage('ru', true);
        }
    },

    toggleCargoFields() {
        const typeEl = document.getElementById('cargoLabelType');
        if (!typeEl) return;

        const type = typeEl.value;
        const receiverFields = document.getElementById('receiverFieldsGroup');
        const senderPhoneParam = document.getElementById('senderPhoneParam');
        const carrierInput = document.getElementById('cargoCarrier');

        if (type === 'code_only') {
            if (receiverFields) receiverFields.classList.add('hidden-cargo-field');
            if (senderPhoneParam) senderPhoneParam.classList.add('hidden-cargo-field');
            if (carrierInput) carrierInput.value = "TRENDYOL GÖNDERİ PAKETİ";
        } else {
            if (receiverFields) receiverFields.classList.remove('hidden-cargo-field');
            if (senderPhoneParam) senderPhoneParam.classList.remove('hidden-cargo-field');
            if (carrierInput) carrierInput.value = "YURTİÇİ KARGO";
        }
    },

    generateCargoLabel() {
        const type = document.getElementById('cargoLabelType').value;
        const carrier = document.getElementById('cargoCarrier').value || '';
        const trackNo = document.getElementById('cargoTrackNo').value || '';
        const senderName = document.getElementById('cargoSenderName').value || '';
        const now = new Date();
        const dateStr = now.toLocaleDateString('tr-TR');

        let tpl = '';

        if (type === 'code_only') {
            tpl = `[C][S:48][W:900]**${senderName.toUpperCase()}**
================================
[C][S:23][W:900]**${carrier.toUpperCase()}**
================================
[CODE128:${trackNo.replace(/\s+/g, '')}|0|0|0|0|1.5]
[C][S:35][W:900]**${trackNo}**
================================
[C][S:24][W:700]${dateStr}`;
        } else {
            const rName = document.getElementById('cargoReceiverName').value || '';
            const rPhone = document.getElementById('cargoReceiverPhone').value || '';
            const rAddr = document.getElementById('cargoReceiverAddress').value || '';
            const sPhone = document.getElementById('cargoSenderPhone').value || '';

            tpl = `[C][S:36][W:900]**${carrier.toUpperCase()}**
[C][S:35]${trackNo}
--------------------------------------------------------
[S:22]**ALICI:** ${rName}
[S:22]Tel: ${rPhone}
[S:22]Adres: ${rAddr}


--------------------------------------------------------
[S:30]**GÖNDERİCİ:** 
[S:30]${senderName} 
[S:30](${sPhone})
--------------------------------------------------------
[QR:memonex3d.com|1|266|246|0|0.48]`;
        }

        const textarea = document.getElementById('textInput');
        if (textarea) textarea.value = tpl;
        
        const markdownTabBtn = document.querySelector('.tab-btn[data-tab="markdown"]');
        if (markdownTabBtn) markdownTabBtn.click();
        
        if (typeof this.updatePreview === 'function') {
            this.updatePreview();
        }
    }
};

window.onload = () => App.init();