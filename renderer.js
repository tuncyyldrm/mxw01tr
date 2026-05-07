const Renderer = {
    canvas: document.getElementById('mainCanvas'),
    get ctx() { return this.canvas.getContext('2d'); },
    lastRenderedPositions: {},
    _loading: {},

    // Font Ayarları ve Cache
    style: {
        fontSize: 16,
        lineSpacing: 1.2,
        fontFamily: 'Arial',
        currentSize: 16,
        isBold: true
    },

ensureResourceLoaded(type, id, storageId) {
    // Zaten yüklenmişse veya şu an yükleniyorsa dur
    if (this._loading[storageId] || (ImageManager.storage && ImageManager.storage[storageId])) return;
    
    this._loading[storageId] = true;

    const finalize = (img) => {
        if (!ImageManager.storage) ImageManager.storage = {};
        ImageManager.storage[storageId] = img;
        delete this._loading[storageId];
        
        // Uygulama arayüzünü güncelle (Önizleme tazeleme)
        if (typeof App !== 'undefined' && typeof App.updatePreview === 'function') {
            App.updatePreview();
        }
    };

    if (type === 'QR') {
        if (typeof QRCode === 'undefined') {
            console.error("QR Code kütüphanesi yüklü değil!");
            delete this._loading[storageId];
            return;
        }

        // Termal yazıcılar için QR Optimizasyonu: 
        // Kenar yumuşatmasız (pixelated) ve yüksek kontrastlı üretim
        const qrCanvas = document.createElement('canvas');
        QRCode.toCanvas(qrCanvas, id, { 
            width: 240, // Daha yüksek çözünürlük, render sırasında scale edilecek
            margin: 1,
            color: {
                dark: "#000000",
                light: "#ffffff"
            },
            errorCorrectionLevel: 'H' // Termal kağıttaki çizilmelere karşı 'High' koruma
        }, (err) => {
            if (err) {
                console.error("QR oluşturma hatası:", err);
                delete this._loading[storageId];
                return;
            }

            const img = new Image();
            img.onload = () => finalize(img);
            // Image data'yı alırken kaliteyi koru
            img.src = qrCanvas.toDataURL('image/png');
        });

    } else {
        // Normal görsel yükleme
        ImageManager.importImage(id, storageId)
            .then(() => {
                delete this._loading[storageId];
                if (typeof App !== 'undefined') App.updatePreview();
            })
            .catch((err) => {
                console.error("Görsel yükleme başarısız:", id, err);
                delete this._loading[storageId];
            });
    }
},

drawLine(type, y) {
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.strokeStyle = 'black';
    this.ctx.setLineDash([]);
    this.ctx.lineCap = 'square'; // Çizgi uçlarını netleştirir

    const startX = 5;
    const endX = 379;
    const centerY = Math.round(y + 8);

    if (type === '---') { 
        // Standart İnce Çizgi: 1 piksel tam netlik
        this.ctx.lineWidth = 1;
        this.ctx.moveTo(startX, centerY);
        this.ctx.lineTo(endX, centerY);
    } 
    else if (type === '===') { 
        // Çift Çizgi: Aralarında yeterli boşluk bırakıldı (ısı birikmesini önler)
        this.ctx.lineWidth = 1.5;
        this.ctx.moveTo(startX, centerY - 2);
        this.ctx.lineTo(endX, centerY - 2);
        this.ctx.moveTo(startX, centerY + 2);
        this.ctx.lineTo(endX, centerY + 2);
    } 
    else if (type === '~~~') { 
        // Dalgalı Çizgi: Daha keskin (sin -> step-like) görünüm için adım sayısı optimize edildi
        this.ctx.lineWidth = 1.2;
        this.ctx.moveTo(startX, centerY);
        const step = 4; // Adım aralığı
        const amplitude = 3; // Dalga yüksekliği
        for (let x = startX; x <= endX; x += step) {
            // Termal yazıcıda yumuşak geçişler bazen silikleşir, o yüzden Math.sin'i koruyoruz
            // ancak x değerlerini tam sayıya yaklaştırıyoruz.
            const nextY = centerY + Math.sin((x - startX) / 6) * amplitude;
            this.ctx.lineTo(x, nextY);
        }
    } 
    else if (type === '...') { 
        // EKSTRA: Noktalı Çizgi (Kupon kesme hattı gibi)
        this.ctx.lineWidth = 1.5;
        this.ctx.setLineDash([4, 4]); 
        this.ctx.moveTo(startX, centerY);
        this.ctx.lineTo(endX, centerY);
    }

    this.ctx.stroke();
    this.ctx.restore();
},

    // Yeni: Tablo Çizici
drawTable(line, currentY, isReal) {
    // Sütunları parçala ve temizle
    const columns = line.split('|').map(c => c.trim()).filter(c => c !== '');
    if (columns.length === 0) return 0;

    const CANVAS_WIDTH = 384;
    const PADDING = 4;
    const colWidth = (CANVAS_WIDTH - 10) / columns.length; // Kenar boşluklarını düşerek böl

    if (isReal) {
        this.ctx.save();
        // Tablo başlığı tespiti (Opsiyonel: Eğer tüm sütunlar bold ise veya ilk satırsa)
        this.ctx.font = `600 ${this.style.fontSize}px ${this.style.fontFamily}`;
        this.ctx.imageSmoothingEnabled = false;

        columns.forEach((col, index) => {
            const x = 5 + (index * colWidth);
            
            // --- Sütun İçeriği Çizimi ---
            // Sütun genişliğine göre metni kırp (Taşmayı önle)
            let text = col;
            const maxWidth = colWidth - (PADDING * 2);
            while (this.ctx.measureText(text).width > maxWidth && text.length > 0) {
                text = text.substring(0, text.length - 1);
            }

            // Sola ve sağa çok hafif dağıtarak "Double Strike" etkisini tabloya da uygula
            this.ctx.fillText(text, x + PADDING - 0.15, currentY);
            this.ctx.fillText(text, x + PADDING + 0.15, currentY);
            
            // --- Dikey Ayırıcı Çizgiler (Border) ---
            if (index > 0) {
                this.ctx.beginPath();
                this.ctx.setLineDash([2, 2]); // Kesikli çizgi termal kağıtta daha az ısınma/yapışma yapar
                this.ctx.moveTo(x, currentY - 2);
                this.ctx.lineTo(x, currentY + (this.style.fontSize * this.style.lineSpacing));
                this.ctx.strokeStyle = '#666'; // Hafif gri (dithering ile siyah-beyaz nokta olur)
                this.ctx.stroke();
            }
        });
        this.ctx.restore();
    }

    // Satır yüksekliğini hesapla ve döndür
    return this.style.fontSize * this.style.lineSpacing;
},

processVisualElement(type, content, currentY, isReal) {
    const parts = content.split('|');
    
    // Parametreleri parçala ve varsayılan değerleri ata
    const id = parts[0] ? parts[0].trim() : '';
    const mode = parseInt(parts[1]) || 0; // 0: Akışa uygun (Inline), 1: Serbest (Absolute)
    const xOffset = parseInt(parts[2]) || 0;
    const yOffset = parseInt(parts[3]) || 0;
    const rotation = parseInt(parts[4]) || 0;
    const scale = parseFloat(parts[5]) || 1.0;

    const storageId = (type === 'QR') ? `qr_${id}` : id;
    const imgObj = ImageManager.storage[storageId];

    // Kaynak yüklenmemişse yüklemeyi başlat ve geçici bir boşluk bırak
    if (!imgObj) {
        this.ensureResourceLoaded(type, id, storageId);
        // Inline modda 175px (varsayılan QR boyutu) yer ayır, serbest modda yer kaplama
        return mode === 0 ? 175 : 0;
    }

    // Boyut hesaplamaları
    const w = imgObj.width * scale;
    const h = imgObj.height * scale;

    let centerX, centerY;

    if (mode === 1) {
        // Serbest Yerleşim (Absolute): Canvas koordinatlarını kullanır
        centerX = xOffset + w / 2;
        centerY = yOffset + h / 2;
    } else {
        // Akışa Uygun (Inline): Mevcut Y satırına ve yatay merkeze göre
        centerX = (384 / 2) + xOffset; 
        centerY = currentY + h / 2 + yOffset;
    }

    if (isReal) {
        this.ctx.save();
        
        // Termal yazıcılarda 'multiply' bazen beklenmedik gri tonlar üretir.
        // En net sonuç için globalAlpha ve smoothing kontrolü:
        this.ctx.imageSmoothingEnabled = false; 
        
        // Transformasyon işlemleri
        this.ctx.translate(centerX, centerY);
        this.ctx.rotate(rotation * Math.PI / 180);

        // Görseli çiz (Merkezden dışa doğru)
        this.ctx.drawImage(imgObj, -w / 2, -h / 2, w, h);

        // Editör etkileşimi: Eğer öğe seçiliyse seçim çerçevesini çiz
        if (typeof App !== 'undefined' && storageId === App.selectedId) {
            this.drawSelectionOverlay(w, h);
        }

        this.ctx.restore();
    }

    // Tıklama ve sürükleme tespiti için pozisyonu kaydet
    this.lastRenderedPositions[storageId] = {
        x: centerX - w / 2,
        y: centerY - h / 2,
        w: w,
        h: h,
        mode: mode,
        r: rotation,
        s: scale
    };

    // Inline modda altındaki metne geçmek için yüksekliği dön, serbest modda 0 dön
    return mode === 0 ? (h + 15) : 0;
},

/**
 * Seçili öğenin etrafına editör çizgilerini çizer.
 * Termal baskıya dahil edilmez, sadece önizlemede görünür.
 */
drawSelectionOverlay(w, h) {
    this.ctx.strokeStyle = '#0078d7'; // Seçim rengi (mavi)
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([5, 5]); // Kesikli çizgi
    
    // Çerçeve
    this.ctx.strokeRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4);
    
    // Köşe tutamaçları (Basit bir görsel gösterge)
    this.ctx.fillStyle = '#0078d7';
    this.ctx.setLineDash([]);
    const handleSize = 6;
    this.ctx.fillRect(w / 2 - handleSize / 2, h / 2 - handleSize / 2, handleSize, handleSize);
},

renderMarkdown(text, params) {
    this.lastRenderedPositions = {};
    const { fontSize, lineSpacing, offsetX, fontFamily } = params;
    
    // Temel stil ayarları
    this.style = { 
        fontSize, 
        lineSpacing, 
        offsetX: offsetX || 0, 
        fontFamily: fontFamily || 'Arial', 
        currentSize: fontSize 
    };
    
    const lines = text.split('\n');
    const CANVAS_WIDTH = 384;
    const PADDING_X = 5; // Kenar güvenli alan

    const drawLoop = (isReal) => {
        let currentY = 5; // Başlangıç boşluğu
        let boxStartY = null;
        let currentBoxType = 'solid';

        if (isReal) {
            this.ctx.imageSmoothingEnabled = false; // Termal baskıda grileşmeyi önler
            this.ctx.textBaseline = "top";
            this.ctx.fillStyle = "black";
        }

        lines.forEach(line => {
            let cleanLine = line.trim();
            
            // Boş satır yönetimi
            if (cleanLine === '') { 
                currentY += this.style.fontSize * 0.8; 
                return; 
            }

            // 1. Görsel Öğeler (IMG/QR)
            const tagMatch = cleanLine.match(/^\[(IMG|QR):(.+?)\]$/);
            if (tagMatch) {
                currentY += this.processVisualElement(tagMatch[1], tagMatch[2], currentY, isReal);
                return;
            }

            // 2. Tablo İşleme
            if (cleanLine.startsWith('|') && cleanLine.endsWith('|')) {
                currentY += this.drawTable(cleanLine, currentY, isReal);
                return;
            }

            // 3. Ayırıcı Çizgiler
            if (['---', '===', '~~~'].includes(cleanLine)) {
                if (isReal) this.drawLine(cleanLine, currentY);
                currentY += 15; 
                return;
            }

            // 4. Kutu (BOX) Başlatma/Bitirme
            if (cleanLine.startsWith('[BOX')) {
                boxStartY = currentY;
                currentBoxType = cleanLine.includes(':dots') ? 'dots' : 'solid';
                currentY += 10; // Üst iç boşluk
                return;
            }
            if (cleanLine.includes('[/BOX]')) {
                if (isReal && boxStartY !== null) {
                    this.ctx.save();
                    this.ctx.lineWidth = 2;
                    this.ctx.strokeStyle = 'black';
                    if (currentBoxType === 'dots') this.ctx.setLineDash([5, 5]);
                    // Kutuyu çiz (Sol: 2px, Sağ: 382px genişlik)
                    this.ctx.strokeRect(2, boxStartY, CANVAS_WIDTH - 4, currentY - boxStartY);
                    this.ctx.restore();
                }
                boxStartY = null; 
                currentY += 10; // Alt dış boşluk
                return;
            }

            // 5. Metin Özelliklerini Belirle
            let sizeMult = 1, isBold = false, indent = 0, bullet = null;
            
            if (cleanLine.startsWith('# ')) { sizeMult = 1.6; isBold = true; cleanLine = cleanLine.substring(2); }
            else if (cleanLine.startsWith('## ')) { sizeMult = 1.3; isBold = true; cleanLine = cleanLine.substring(3); }
            else if (cleanLine.startsWith('* ')) { bullet = '•'; indent = 20; cleanLine = cleanLine.substring(2); }

            // Inline Parametreler [S:size], [W:weight], [C]enter, [R]ight
            let sizeMatch = cleanLine.match(/\[S:(\d+)\]/);
            let weightMatch = cleanLine.match(/\[W:(\d+)\]/);
            let isCentered = cleanLine.includes('[C]');
            let isRight = cleanLine.includes('[R]');
            let isMonospace = cleanLine.includes('[M]');

            let lineSize = sizeMatch ? parseInt(sizeMatch[1]) : this.style.fontSize;
            let fontWeight = weightMatch ? weightMatch[1] : (isBold ? '900' : '600');
            
            cleanLine = cleanLine.replace(/\[S:\d+\]/g, '')
                                 .replace(/\[W:\d+\]/g, '')
                                 .replace(/\[C\]|\[R\]|\[M\]/g, '')
                                 .trim();

            const finalSize = lineSize * sizeMult;
            const fontStack = isMonospace ? 'Consolas, monospace' : `"${this.style.fontFamily}", Arial, sans-serif`;
            this.ctx.font = `${fontWeight} ${finalSize}px ${fontStack}`;

            // 6. Otomatik Satır Kaydırma (Word Wrap)
            const maxWidth = CANVAS_WIDTH - (this.style.offsetX + indent + (boxStartY ? 20 : 10));
            const wrappedLines = this.wrapText(cleanLine, maxWidth);

            wrappedLines.forEach(wLine => {
                let xPos = this.style.offsetX + indent + PADDING_X;
                if (boxStartY !== null) xPos += 8; // Kutu içi ekstra indent

                const measureTxt = wLine.replace(/\*\*|\*|_/g, '');
                const textWidth = this.ctx.measureText(measureTxt).width;

                if (isCentered) xPos = (CANVAS_WIDTH - textWidth) / 2;
                else if (isRight) xPos = CANVAS_WIDTH - textWidth - PADDING_X - (boxStartY ? 10 : 0);

                if (isReal) {
                    this.renderStyledText(
                        wLine, 
                        Math.round(xPos), 
                        Math.round(currentY), 
                        finalSize, 
                        fontStack, 
                        true, 
                        bullet, 
                        fontWeight
                    );
                }
                
                // Bullet sadece ilk satıra eklenir
                bullet = null; 
                currentY += finalSize * this.style.lineSpacing;
            });
        });
        return currentY;
    };

    // --- Çalıştırma Mantığı ---
    this.canvas.width = CANVAS_WIDTH;
    
    // 1. Pas: Yüksekliği hesapla
    const totalH = drawLoop(false);
    this.canvas.height = totalH + 20;

    // 2. Pas: Gerçek çizimi yap
    this.ctx.fillStyle = "white";
    this.ctx.fillRect(0, 0, CANVAS_WIDTH, this.canvas.height);
    drawLoop(true);
},

// Yardımcı Fonksiyon: Metni sınırlı genişliğe göre böler
wrapText(text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
        const word = words[i];
        // Markdown karakterlerini ölçümden çıkararak hesapla
        const testLine = currentLine + " " + word;
        const measureLine = testLine.replace(/\*\*|\*|_/g, '');
        const width = this.ctx.measureText(measureLine).width;
        
        if (width < maxWidth) {
            currentLine = testLine;
        } else {
            lines.push(currentLine);
            currentLine = word;
        }
    }
    lines.push(currentLine);
    return lines;
},

renderStyledText(text, x, y, size, font, isReal, bullet, baseWeight) {
    let currentX = x;
    let i = 0;
    let chunk = "";
    
    // Başlangıç stilleri
    let activeStyles = { 
        bold: baseWeight === 'bold' || parseInt(baseWeight) >= 700, 
        italic: false 
    };

    const flush = () => {
        if (chunk === "") return;
        
        // Font ağırlığını belirle: Eğer markdown ile bold yapılmışsa veya baseWeight zaten kalınsa en tepe değeri kullan
        const finalWeight = activeStyles.bold ? '900' : baseWeight;
        this.ctx.font = `${activeStyles.italic ? 'italic ' : ''}${finalWeight} ${size}px ${font}`;
        
// renderStyledText içindeki flush fonksiyonunun ilgili kısmı:
if (isReal) {
    if (currentX === x && bullet) {
        this.ctx.fillText(bullet, x - 15, y);
    }
    
    // --- Sizin Geliştirdiğiniz "Center-Focused Double Strike" ---
    // Bu yöntem, 0.5px sağa kaydırmaya göre daha ince ve keskin bir dolgunluk sağlar.
    this.ctx.fillText(chunk, currentX - 0.15, y);
    this.ctx.fillText(chunk, currentX + 0.15, y);
    
    // Eğer font çok büyükse (Başlık), dikeyde de destek atalım
    if (size > 24) {
        this.ctx.fillText(chunk, currentX, y + 0.15);
    }
}
        
        currentX += this.ctx.measureText(chunk).width;
        chunk = "";
    };

    while (i < text.length) {
        // Markdown Kontrolleri
        if (text.startsWith('**', i)) {
            flush();
            activeStyles.bold = !activeStyles.bold;
            i += 2;
        } else if (text.startsWith('*', i)) {
            flush();
            activeStyles.italic = !activeStyles.italic;
            i += 1;
        } else if (text.startsWith('_', i)) {
            // Alt çizgi termal kağıtta piksellerin birbirine girmesine neden olur, 
            // ama yine de desteklemek istersen burada stroke() kullanabilirsin.
            i += 1; 
        } else {
            chunk += text[i];
            i++;
        }
    }
    flush();
},
    
getBitmapBytes() {
    const width = 384; // Yazıcı kafa genişliği sabit
    const height = this.canvas.height;
    const ctx = this.ctx;
    
    // willReadFrequently optimizasyonu (eğer canvas oluşturulurken verilmediyse)
    const imgData = ctx.getImageData(0, 0, width, height).data;

    const bytesPerRow = width / 8;
    const bytes = new Uint8Array(bytesPerRow * height);
    const gray = new Float32Array(width * height);

    // 1. Aşama: Gri Tonlama ve Kontrast (Tek döngüde)
    for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        // Alfa kanalı kontrolü: Şeffaf pikselleri beyaz (255) kabul et
        if (imgData[idx + 3] < 128) {
            gray[i] = 255;
            continue;
        }

        const r = imgData[idx], g = imgData[idx + 1], b = imgData[idx + 2];
        let grayVal = (r * 0.299 + g * 0.587 + b * 0.114);
        
        // Agresif Kontrast (Gama düzeltmesi gibi çalışır)
        if (grayVal < 200) {
            grayVal = Math.pow(grayVal / 255, 2.2) * 255; 
        }
        gray[i] = grayVal;
    }

    const threshold = 128; // Standart eşik değeri
    const errorWeight = 0.35;

    // 2. Aşama: Atkinson-benzeri hafif Dithering ve Paketleme
    for (let y = 0; y < height; y++) {
        const yOffset = y * width;
        const byteRowOffset = y * bytesPerRow;

        for (let x = 0; x < width; x++) {
            const i = yOffset + x;
            const oldPixel = gray[i];
            const newPixel = oldPixel < threshold ? 0 : 255;
            
            // Hata hesapla
            const error = (oldPixel - newPixel) * errorWeight;
            
            // Komşu piksellere yay (Hızlı yayılım)
            if (x + 1 < width) gray[i + 1] += error * 0.5;
            if (y + 1 < height) gray[i + width] += error * 0.5;

            // Piksel siyahsa ilgili biti 1 yap (Termal yazıcı kuralı: 1 = Isıt/Bas)
            if (newPixel === 0) {
                const byteIdx = byteRowOffset + (x >> 3); // Math.floor(x/8) yerine bitwise shift
                bytes[byteIdx] |= (1 << (x & 7));      // x % 8 yerine bitwise AND
            }
        }
    }

    return { bytes, height };
}
};