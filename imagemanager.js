const ImageManager = {
    storage: {},      // İşlenmiş HTMLImageElement nesneleri
    originalBlobs: {}, // Orijinal resim verileri (Yeniden işleme için ŞART)
    placedImages: [],
    selectedId: null,
    renderMode: 'photo', // 'photo' veya 'sketch'
    intensity: 100,      // Varsayılan yoğunluk (0-200 arası)

    init() {
        console.log("ImageManager Başlatıldı. Mod:", this.renderMode, "Yoğunluk:", this.intensity);
    },

    // KOYULUK AYARI: Slider değiştikçe çağrılır
    async setIntensity(val) {
        this.intensity = parseInt(val);
        // UI'da rakamsal geri bildirim varsa güncelle
        const valDisplay = document.getElementById('intensityVal');
        if (valDisplay) valDisplay.innerText = val;

        console.log("Yoğunluk Güncellendi:", this.intensity);
        await this.reprocessAll();
    },

    // MOD DEĞİŞTİRME
    async setMode(mode) {
        if (this.renderMode === mode) return;
        this.renderMode = mode;
        console.log("Mod Değiştirildi:", mode === 'photo' ? "📸 Fotoğraf" : "🎨 Çizim");

        // UI Buton aktiflik durumu
        document.querySelectorAll('.btn-mode').forEach(btn => {
            const onclickAttr = btn.getAttribute('onclick') || "";
            btn.classList.toggle('active', onclickAttr.includes(mode));
        });

        await this.reprocessAll();
    },

    // Tüm resimleri mevcut ayarlarla (mod + yoğunluk) tekrar işle
    async reprocessAll() {
        const tasks = [];
        for (let id in this.originalBlobs) {
            tasks.push(this.process(this.originalBlobs[id], id));
        }

        if (tasks.length > 0) {
            await Promise.all(tasks);
            this.updateUI();
            if (typeof App !== 'undefined') App.updatePreview();
        }
    },

    async process(blob, id) {
        this.originalBlobs[id] = blob;
        const url = URL.createObjectURL(blob);
        
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const targetWidth = 384; // Termal yazıcı genişliği
                const scale = targetWidth / img.width;
                canvas.width = targetWidth;
                canvas.height = img.height * scale;

                // --- DİNAMİK FİLTRELEME ---
                if (this.renderMode === 'photo') {
                    // Yoğunluk arttıkça parlaklık düşer (Daha çok siyah nokta oluşur)
                    // 100 yoğunlukta %110 parlaklık verir.
                    const brightness = 210 - this.intensity; 
                    ctx.filter = `grayscale(100%) contrast(120%) brightness(${brightness}%)`;
                } else {
                    // Çizim modunda kenarları netleştirmek için sabit filtre
                    ctx.filter = `grayscale(100%) contrast(115%) brightness(105%)`;
                }

                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const data = imageData.data;
                const width = canvas.width;
                const height = canvas.height;

                if (this.renderMode === 'photo') {
                    // --- ATKINSON DITHERING ---
                    for (let y = 0; y < height; y++) {
                        for (let x = 0; x < width; x++) {
                            const i = (y * width + x) * 4;
                            const oldPixel = data[i];
                            const newPixel = oldPixel < 128 ? 0 : 255;
                            data[i] = data[i+1] = data[i+2] = newPixel;
                            const err = (oldPixel - newPixel) >> 3;
                            const distribute = (dx, dy) => {
                                const nx = x + dx, ny = y + dy;
                                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                                    const ni = (ny * width + nx) * 4;
                                    data[ni] += err;
                                }
                            };
                            distribute(1, 0); distribute(2, 0);
                            distribute(-1, 1); distribute(0, 1); distribute(1, 1);
                            distribute(0, 2);
                        }
                    }
                } else {
                    // --- DİNAMİK EŞİKLİ ÇİZİM (Sketch) ---
                    const output = new Uint8ClampedArray(data.length);
                    // Yoğunluk arttıkça threshold düşer (Daha az fark bile çizgi sayılır)
                    // 100 yoğunlukta threshold ~40 olur.
                    const dynamicThreshold = Math.max(5, 140 - this.intensity);

                    for (let y = 0; y < height - 1; y++) {
                        for (let x = 0; x < width - 1; x++) {
                            const i = (y * width + x) * 4;
                            const h = Math.abs(data[i] - data[i + 4]);
                            const v = Math.abs(data[i] - data[i + (width * 4)]);
                            const edge = Math.sqrt(h * h + v * v);

                            if (edge > dynamicThreshold) {
                                output[i] = output[i+1] = output[i+2] = 0; // Siyah
                                output[i+3] = 255;
                            } else {
                                output[i] = output[i+1] = output[i+2] = 255; // Beyaz
                                output[i+3] = 0;
                            }
                        }
                    }
                    data.set(output);
                }

                // --- FİNAL TEMİZLİK ---
                for (let i = 0; i < data.length; i += 4) {
                    const isBlack = data[i] < 128;
                    data[i] = data[i+1] = data[i+2] = 0;
                    data[i+3] = isBlack ? 255 : 0;
                }

                ctx.putImageData(imageData, 0, 0);
                const processedImg = new Image();
                processedImg.src = canvas.toDataURL('image/png');
                processedImg.onload = () => {
                    this.storage[id] = processedImg;
                    URL.revokeObjectURL(url);
                    resolve(id);
                };
            };
            img.src = url;
        });
    },

    updateUI() {
        const dropZone = document.getElementById('dropZone');
        if (!dropZone) return;
        let html = '<h3>Grafikleriniz:</h3>';
        html += '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 15px;">';
        for (let id in this.storage) {
            const isSelected = (this.selectedId === id);
            html += `
                <div onclick="App.selectImage('${id}')" style="border: 2px solid ${isSelected ? '#007bff' : '#eee'}; border-radius: 8px; padding: 10px; cursor: pointer; background: white; position: relative;">
                    <img src="${this.storage[id].src}" style="width: 100%; height: auto; border-radius: 4px;">
                    <small style="display: block; text-align: center; margin-top: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${id}</small>
                </div>`;
        }
        html += '</div>';
        dropZone.innerHTML = html;
    },

    get(id) { return this.storage[id] || null; }
};

// --- ETKİLEŞİM VE IMPORT FONKSİYONLARI ---

ImageManager.findImageAt = function(mx, my) {
    if (!Renderer || !Renderer.lastRenderedPositions) return null;
    const ids = Object.keys(Renderer.lastRenderedPositions);
    for (let i = ids.length - 1; i >= 0; i--) {
        const id = ids[i];
        const p = Renderer.lastRenderedPositions[id];
        if (mx >= p.x && mx <= p.x + p.w && my >= p.y && my <= p.y + p.h) {
            return { id, mode: p.mode, x: Math.round(p.x), y: Math.round(p.y), rotate: p.r, scale: p.s };
        }
    }
    return null;
};

ImageManager.addFromPaste = function(blob) {
    const id = "img_" + Date.now();
    this.importImage(blob, id);
};

ImageManager.importImage = async function(source, customId = null) {
    let id = customId || (typeof source === 'string' ? source.trim() : `img_${Date.now()}`);
    if (typeof id === 'string') id = id.replace(/\|/g, '%7C');
    
    let blob;
    try {
        if (source instanceof File || source instanceof Blob) {
            blob = source;
        } else {
            const isExternal = source.startsWith('http');
            const fetchUrl = isExternal ? `loadimg.php?url=${encodeURIComponent(source)}` : source;
            const response = await fetch(fetchUrl);
            if (!response.ok) throw new Error('Yükleme Hatası');
            blob = await response.blob();
        }
        
        await this.process(blob, id);
        if (!customId) {
            // Eğer yeni bir resimse (manuel eklenmişse) editöre tag'ini ekle
            if (typeof App !== 'undefined' && App.insertTagAtCursor) {
                App.insertTagAtCursor(`[IMG:${id}|0|0|0|0|1.0]`);
            }
        }
        this.updateUI();
        if (typeof App !== 'undefined') App.updatePreview();
        return id;
    } catch (err) { 
        console.error("İmport hatası:", err); 
    }
};

// Başlat
ImageManager.init();