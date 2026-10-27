// MXW01, Lefuxin ve ESC/POS Termal Yazıcı Sürücüleri

class LefuxinDriver {
    constructor() {
        this.device = null;
        this.ctrl = null;
        this.data = null;
        this.notify = null;
        this.pendingResolvers = new Map();
        this.batteryLevel = null;
    }

    async connect(existingDevice = null) {
        try {
            console.log("MXW01 / Lefuxin bağlantısı başlatılıyor...");

            if (existingDevice) {
                this.device = existingDevice;
            } else {
                this.device = await navigator.bluetooth.requestDevice({
                    acceptAllDevices: true,
                    optionalServices: [
                        '0000ae30-0000-1000-8000-00805f9b34fb', // MXW01 ana servis
                        '0000af30-0000-1000-8000-00805f9b34fb', // Mac / alternatif MXW01 servisi
                        '0000ae00-0000-1000-8000-00805f9b34fb', // Klasik Lefuxin
                        '0000ff00-0000-1000-8000-00805f9b34fb', // Eski modeller
                        '000018f0-0000-1000-8000-00805f9b34fb', // Alternatif yığın
                        '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Broadcom/Çin modülleri
                        '0000fee7-0000-1000-8000-00805f9b34fb'  // AirSync protokolü
                    ]
                });
            }

            this.device.ongattserverdisconnected = () => {
                console.warn("Yazıcı bağlantısı kesildi!");
                if (typeof App !== 'undefined' && App.onPrinterDisconnected) {
                    App.onPrinterDisconnected();
                }
            };

            const server = (this.device.gatt && this.device.gatt.connected) 
                ? this.device.gatt 
                : await this.device.gatt.connect();
            
            // BLE GATT stabilizasyon gecikmesi
            await new Promise(r => setTimeout(r, 600));

            const services = await server.getPrimaryServices();
            this.ctrl = null;
            this.data = null;
            this.notify = null;

            // AE01/AE03 kontrol/veri ve AE02 bildirim kanalını ara
            for (let service of services) {
                try {
                    let c = null, d = null, n = null;
                    try {
                        c = await service.getCharacteristic('0000ae01-0000-1000-8000-00805f9b34fb');
                        d = await service.getCharacteristic('0000ae03-0000-1000-8000-00805f9b34fb');
                    } catch (e1) {
                        c = await service.getCharacteristic('0000af01-0000-1000-8000-00805f9b34fb');
                        d = await service.getCharacteristic('0000af03-0000-1000-8000-00805f9b34fb');
                    }

                    try {
                        n = await service.getCharacteristic('0000ae02-0000-1000-8000-00805f9b34fb');
                    } catch (e2) {
                        try {
                            n = await service.getCharacteristic('0000af02-0000-1000-8000-00805f9b34fb');
                        } catch (e3) {}
                    }
                    
                    if (c && d) {
                        this.ctrl = c;
                        this.data = d;
                        this.notify = n;

                        if (this.notify) {
                            try {
                                await this.notify.startNotifications();
                                this.notify.addEventListener('characteristicvaluechanged', (e) => this._handleNotification(e));
                                console.log("✅ Bildirim kanalı (AE02) aktif.");
                            } catch (eNotif) {
                                console.warn("AE02 bildirim başlatılamadı:", eNotif);
                            }
                        }

                        console.log("✅ Yazıcı kontrol kanalları hazır:", service.uuid);
                        
                        // Bağlandıktan kısa süre sonra pil ve durum sorgula
                        setTimeout(() => this.updateStatus(), 500);

                        return this.device.name || "MXW01 Yazıcı";
                    }
                } catch (e) {
                    continue; 
                }
            }

            throw new Error("Lefuxin/MXW01 kontrol portları (AE01/AE03) bulunamadı.");

        } catch (error) {
            console.error("Lefuxin sürücü hatası:", error);
            throw error;
        }
    }

    _crc(d) {
        let c = 0; 
        for (let b of d) {
            c ^= b; 
            for (let i = 0; i < 8; i++) c = (c & 0x80) ? ((c << 1) ^ 0x07) & 0xFF : (c << 1) & 0xFF;
        } 
        return c;
    }

    async _send(id, p) {
        const d = new Uint8Array(p);
        const pkt = new Uint8Array([0x22, 0x21, id, 0x00, d.length & 0xFF, (d.length >> 8) & 0xFF, ...d, this._crc(d), 0xFF]);
        await this.ctrl.writeValueWithoutResponse(pkt);
        await new Promise(r => setTimeout(r, 50));
    }

    _handleNotification(event) {
        const data = new Uint8Array(event.target.value.buffer);
        if (data.length < 6 || data[0] !== 0x22 || data[1] !== 0x21) return;

        const cmdId = data[2];
        const len = data[4] | (data[5] << 8);
        const payload = data.slice(6, 6 + len);

        // Canlı bildirimleri otomatik yakala ve UI rozetini güncelle
        if (cmdId === 0xA1 && payload.length >= 10) {
            const battery = payload[9];
            const temp = payload.length >= 11 ? payload[10] : null;
            const isError = payload.length >= 13 && payload[12] !== 0;
            const errorCode = isError && payload.length >= 14 ? payload[13] : 0;
            const noPaper = isError && (errorCode === 1 || errorCode === 9);
            if (battery !== null) this.batteryLevel = battery;
            if (typeof App !== 'undefined' && App.onPrinterStatus) {
                App.onPrinterStatus({
                    name: this.device ? this.device.name : 'MXW01',
                    battery: battery,
                    noPaper: noPaper,
                    temp: temp
                });
            }
        } else if (cmdId === 0xAB && payload.length > 0) {
            this.batteryLevel = payload[0];
            if (typeof App !== 'undefined' && App.onPrinterStatus) {
                App.onPrinterStatus({
                    name: this.device ? this.device.name : 'MXW01',
                    battery: payload[0],
                    noPaper: false
                });
            }
        }

        const resolver = this.pendingResolvers.get(cmdId);
        if (resolver) {
            resolver(payload);
            this.pendingResolvers.delete(cmdId);
        }
    }

    _waitForNotification(cmdId, timeoutMs = 3500) {
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.pendingResolvers.delete(cmdId);
                resolve(null);
            }, timeoutMs);

            this.pendingResolvers.set(cmdId, (payload) => {
                clearTimeout(timer);
                resolve(payload);
            });
        });
    }

    async getBatteryLevel() {
        if (!this.ctrl || !this.notify) return null;
        try {
            await this._send(0xAB, [0x00]);
            const payload = await this._waitForNotification(0xAB, 2500);
            if (payload && payload.length > 0) {
                this.batteryLevel = payload[0];
                return this.batteryLevel;
            }
        } catch (e) {
            console.warn("0xAB pil sorgulama hatası:", e);
        }

        const status = await this.getPrinterStatus();
        return status ? status.battery : null;
    }

    async getPrinterStatus() {
        if (!this.ctrl || !this.notify) return null;
        try {
            await this._send(0xA1, [0x00]);
            const payload = await this._waitForNotification(0xA1, 2500);
            if (payload) {
                const battery = payload.length >= 10 ? payload[9] : null;
                const temp = payload.length >= 11 ? payload[10] : null;
                const isError = payload.length >= 13 && payload[12] !== 0;
                const errorCode = isError && payload.length >= 14 ? payload[13] : 0;
                const noPaper = isError && (errorCode === 1 || errorCode === 9);
                if (battery !== null) this.batteryLevel = battery;
                return { battery, temp, isError, errorCode, noPaper };
            }
        } catch (e) {
            console.warn("0xA1 durum sorgulama hatası:", e);
        }
        return null;
    }

    async updateStatus() {
        try {
            const status = await this.getPrinterStatus();
            const battery = (status && status.battery !== null) ? status.battery : await this.getBatteryLevel();
            if (typeof App !== 'undefined' && App.onPrinterStatus) {
                App.onPrinterStatus({
                    name: this.device ? this.device.name : 'MXW01',
                    battery: battery,
                    noPaper: status ? status.noPaper : false,
                    temp: status ? status.temp : null
                });
            }
        } catch (err) {
            console.warn("Yazıcı durumu güncellenemedi:", err);
        }
    }

    async feedPaper(lines = 48) {
        if (!this.ctrl || !this.data) return;
        const h = Math.max(16, Math.min(200, parseInt(lines) || 48));
        try {
            // Lefuxin protokolünde güvenli ilerletme: boş (0x00) raster satırları gönder
            await this._send(0xB1, [0x00]);
            await this._send(0xA9, [h & 0xFF, (h >> 8) & 0xFF, 48, 0]);
            const totalBytes = h * 48;
            const chunk = new Uint8Array(20); // 20 bayt sıfır
            for (let i = 0; i < totalBytes; i += 20) {
                const len = Math.min(20, totalBytes - i);
                await this.data.writeValueWithoutResponse(len === 20 ? chunk : new Uint8Array(len));
                if (i % 200 === 0) await new Promise(r => setTimeout(r, 15));
            }
            await this._send(0xAD, [0x00]);
        } catch (e) {
            console.warn("Lefuxin kağıt ilerletme hatası:", e);
        }
    }

    async print(bytes, h) {
        if (!this.ctrl || !this.data) throw new Error("Yazıcıya bağlantı yok.");
        
        // 1. Baskı başlatma / durum hazırlığı
        await this._send(0xB1, [0x00]); 
        
        // 2. Baskı boyutu bilgisi: yükseklik ve satır genişliği (48 bayt = 384 dot)
        await this._send(0xA9, [h & 0xFF, (h >> 8) & 0xFF, 48, 0]);
        
        // 3. Raster görüntü verisini AE03 üzerinden 20 baytlık BLE paketleriyle gönder
        for (let i = 0; i < bytes.length; i += 20) {
            await this.data.writeValueWithoutResponse(bytes.slice(i, i + 20));
            if (i % 200 === 0) await new Promise(r => setTimeout(r, 20));
        }
        
        // 4. Veri aktarımını tamamla ve kağıdı ilerlet
        await this._send(0xAD, [0x00]);

        // Baskı sonrası güncel pil durumunu tazele
        setTimeout(() => this.updateStatus(), 1200);
    }
}

class ESCPOSDriver {
    constructor() {
        this.device = null;
        this.txChar = null;
        this.rxChar = null;
        this.printerService = null;
    }

    async connect(existingDevice = null) {
        try {
            console.log("ESC/POS yazıcı aranıyor...");
            
            if (existingDevice) {
                this.device = existingDevice;
            } else {
                this.device = await navigator.bluetooth.requestDevice({
                    acceptAllDevices: true,
                    optionalServices: [
                        '000018f0-0000-1000-8000-00805f9b34fb',  // XPrinter
                        '49535343-fe7d-4ae5-8fa9-9fafd205e455',  // Nordic/Adafruit
                        'e7810a71-73ae-499d-8c15-faa9aef0c3f2',  // Sunmi
                        '00001101-0000-1000-8000-00805f9b34fb',  // Standart SPP
                        '00001800-0000-1000-8000-00805f9b34fb'   // Generic Access
                    ]
                });
            }

            this.device.ongattserverdisconnected = () => {
                console.warn("Yazıcı bağlantısı kesildi!");
                if (typeof App !== 'undefined' && App.onPrinterDisconnected) {
                    App.onPrinterDisconnected();
                }
            };

            const server = (this.device.gatt && this.device.gatt.connected) 
                ? this.device.gatt 
                : await this.device.gatt.connect();
            
            const services = await server.getPrimaryServices();
            
            for (let service of services) {
                try {
                    // Seçenek 1: SPP portu
                    if (service.uuid === '00001101-0000-1000-8000-00805f9b34fb') {
                        const tx = await service.getCharacteristic('00001101-0000-1000-8000-00805f9b34fb');
                        this.txChar = tx;
                        this.printerService = service;
                        break;
                    }
                    
                    // Seçenek 2: Özel ISSC servisi
                    const tx = await service.getCharacteristic('49535343-8841-43f4-a8d4-ecbe34729bb3');
                    const rx = await service.getCharacteristic('49535343-1e4d-4bd9-ba61-23c647249616');
                    
                    if (tx) {
                        this.txChar = tx;
                        this.rxChar = rx;
                        this.printerService = service;
                        break;
                    }
                } catch (e) {
                    continue;
                }
            }

            if (!this.txChar) {
                throw new Error("ESC/POS yazıcı yazdırma kanalı bulunamadı.");
            }

            return this.device.name || "ESC/POS Yazıcı";
            
        } catch (error) {
            console.error("ESC/POS bağlantı hatası:", error);
            throw error;
        }
    }

    async initializePrinter() {
        const initCommands = new Uint8Array([
            0x1B, 0x40,       // ESC @ (Yazıcıyı sıfırla)
            0x1B, 0x4D, 0x00, // Font A seç
            0x1B, 0x33, 0x00  // Satır aralığını sıfırla
        ]);
        
        await this.txChar.writeValueWithoutResponse(initCommands);
        await new Promise(r => setTimeout(r, 150));
    }

    async print(bytes, h) {
        if (!this.txChar) throw new Error("Yazıcı bağlı değil.");
        
        await this.initializePrinter();
        
        // ESC/POS için bit sırasını MSB-first formatına çevir (Bit 7 = Sol piksel)
        const reversedBytes = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) {
            let b = bytes[i];
            reversedBytes[i] = ((b * 0x0802 & 0x22110) | (b * 0x8020 & 0x88440)) * 0x10101 >> 16 & 0xFF;
        }

        // GS v 0 (0x1D, 0x76, 0x30, m, xL, xH, yL, yH) - Raster Bit Image komutu
        // m = 0 (Normal mod), xL = 48 (384 / 8 = 48 bayt genişlik), xH = 0
        const rasterCmd = new Uint8Array([
            0x1D, 0x76, 0x30, 0x00,
            48, 0x00,
            h & 0xFF, (h >> 8) & 0xFF
        ]);
        await this.txChar.writeValueWithoutResponse(rasterCmd);
        await new Promise(r => setTimeout(r, 50));
        
        // 20 baytlık paketlerle veriyi yazıcıya ilet
        for (let i = 0; i < reversedBytes.length; i += 20) {
            await this.txChar.writeValueWithoutResponse(reversedBytes.slice(i, Math.min(i + 20, reversedBytes.length)));
            if (i % 200 === 0) await new Promise(r => setTimeout(r, 20));
        }
        
        // 3 satır besleme
        const feedCmd = new Uint8Array([0x1B, 0x64, 0x03]);
        await this.txChar.writeValueWithoutResponse(feedCmd);
    }

    async feedPaper(lines = 3) {
        if (!this.txChar) return;
        const l = Math.max(1, Math.min(10, parseInt(lines) || 3));
        const feedCmd = new Uint8Array([0x1B, 0x64, l]);
        await this.txChar.writeValueWithoutResponse(feedCmd);
    }
}

class BLEProtocolDriver {
    constructor() {
        this.device = null;
        this.txChar = null;
        this.rxChar = null;
        this.fragmentSize = 512;
    }

    async connect(existingDevice = null) {
        try {
            console.log("BLE Seri bağlantı noktasına sahip yazıcı aranıyor...");
            
            if (existingDevice) {
                this.device = existingDevice;
            } else {
                this.device = await navigator.bluetooth.requestDevice({
                    filters: [{ namePrefix: 'HMSoft' }, { namePrefix: 'ZH03' }, { namePrefix: 'BLE' }],
                    optionalServices: [
                        '0000ff00-0000-1000-8000-00805f9b34fb',  // Seri veri
                        '0000ff01-0000-1000-8000-00805f9b34fb',  // Seri kontrol
                        '6e400001-b5a3-f393-e0a9-e50e24dcca9e',  // Nordic UART
                        '0000fee7-0000-1000-8000-00805f9b34fb'   // Apple Continuity
                    ]
                });
            }

            this.device.ongattserverdisconnected = () => {
                console.warn("Yazıcı bağlantısı kesildi!");
                if (typeof App !== 'undefined' && App.onPrinterDisconnected) {
                    App.onPrinterDisconnected();
                }
            };

            const server = (this.device.gatt && this.device.gatt.connected) 
                ? this.device.gatt 
                : await this.device.gatt.connect();
            
            try {
                const service = await server.getPrimaryService('0000ff00-0000-1000-8000-00805f9b34fb');
                this.txChar = await service.getCharacteristic('0000ff02-0000-1000-8000-00805f9b34fb');
                this.rxChar = await service.getCharacteristic('0000ff01-0000-1000-8000-00805f9b34fb');
            } catch (e) {
                const service = await server.getPrimaryService('6e400001-b5a3-f393-e0a9-e50e24dcca9e');
                this.txChar = await service.getCharacteristic('6e400002-b5a3-f393-e0a9-e50e24dcca9e');
                this.rxChar = await service.getCharacteristic('6e400003-b5a3-f393-e0a9-e50e24dcca9e');
            }

            this.fragmentSize = 512;
            return this.device.name || "BLE Seri Yazıcı";
            
        } catch (error) {
            console.error("BLE Seri bağlantı hatası:", error);
            throw error;
        }
    }

    async _sendCommand(cmd) {
        if (!this.txChar) throw new Error("Yazıcı bağlı değil.");
        
        for (let i = 0; i < cmd.length; i += this.fragmentSize) {
            const fragment = cmd.slice(i, i + this.fragmentSize);
            await this.txChar.writeValueWithoutResponse(fragment);
            await new Promise(r => setTimeout(r, 20));
        }
    }

    async print(bytes, h) {
        // Sıfırlama
        const initCmd = new Uint8Array([0x1B, 0x40]);
        await this._sendCommand(initCmd);
        
        // Bit sırasını MSB'ye çevir
        const reversedBytes = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) {
            let b = bytes[i];
            reversedBytes[i] = ((b * 0x0802 & 0x22110) | (b * 0x8020 & 0x88440)) * 0x10101 >> 16 & 0xFF;
        }

        // GS v 0 raster komutu: 48 bayt genişlik, h yükseklik
        const rasterCmd = new Uint8Array([
            0x1D, 0x76, 0x30, 0x00,
            48, 0x00,
            h & 0xFF, (h >> 8) & 0xFF
        ]);
        await this._sendCommand(rasterCmd);
        await this._sendCommand(reversedBytes);
        
        // 3 satır besleme
        const feedCmd = new Uint8Array([0x1B, 0x64, 0x03]);
        await this._sendCommand(feedCmd);
    }

    async feedPaper(lines = 3) {
        if (!this.txChar) return;
        const l = Math.max(1, Math.min(10, parseInt(lines) || 3));
        const feedCmd = new Uint8Array([0x1B, 0x64, l]);
        await this._sendCommand(feedCmd);
    }
}

// =========================================================================
// Kedi Kulaklı Mini Termal Yazıcı Sürücüsü (0x51 0x78 Protokolü)
// Uyumlu Modeller: C9, C13, C15, C17, C19, C21, GB01, GB02, WalkPrint, FunPrint, iPrint vb.
// =========================================================================
class CatPrinterDriver {
    constructor() {
        this.device = null;
        this.txChar = null;
        this.rxChar = null;
        this.batteryLevel = null;
    }

    async connect(existingDevice = null) {
        try {
            console.log("Kedi Mini / C9 / GB01 (0x5178) bağlantısı başlatılıyor...");

            if (existingDevice) {
                this.device = existingDevice;
            } else {
                this.device = await navigator.bluetooth.requestDevice({
                    acceptAllDevices: true,
                    optionalServices: [
                        '0000ff00-0000-1000-8000-00805f9b34fb', // Kedi / C9 ana servisi
                        '0000fee7-0000-1000-8000-00805f9b34fb', // AirSync servisi
                        '0000fff0-0000-1000-8000-00805f9b34fb', // Alternatif modül
                        '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC seri
                        '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART
                        '0000ae30-0000-1000-8000-00805f9b34fb'  // Lefuxin hibrit
                    ]
                });
            }

            this.device.ongattserverdisconnected = () => {
                console.warn("Kedi Mini yazıcı bağlantısı kesildi!");
                if (typeof App !== 'undefined' && App.onPrinterDisconnected) {
                    App.onPrinterDisconnected();
                }
            };

            const server = (this.device.gatt && this.device.gatt.connected)
                ? this.device.gatt
                : await this.device.gatt.connect();

            await new Promise(r => setTimeout(r, 600));

            const services = await server.getPrimaryServices();
            this.txChar = null;
            this.rxChar = null;

            // 1. Öncelikli olarak standart FF00 / FEE7 / FFF0 servislerini ve FF02/FF01 portlarını ara
            for (let service of services) {
                const sUuid = service.uuid.toLowerCase();
                try {
                    if (sUuid.includes('ff00') || sUuid.includes('fee7') || sUuid.includes('fff0')) {
                        try {
                            this.txChar = await service.getCharacteristic('0000ff02-0000-1000-8000-00805f9b34fb');
                        } catch (eTx) {}
                        try {
                            this.rxChar = await service.getCharacteristic('0000ff01-0000-1000-8000-00805f9b34fb');
                        } catch (eRx) {}
                        if (this.txChar) break;
                    }
                } catch (e) {}
            }

            // 2. Bulunamadıysa tüm servisleri tara: TX (Write) ve RX (Notify) karakteristiklerini otomatik eşleştir
            if (!this.txChar) {
                for (let service of services) {
                    try {
                        const chars = await service.getCharacteristics();
                        for (let ch of chars) {
                            const props = ch.properties;
                            if (!this.txChar && (props.writeWithoutResponse || props.write)) {
                                this.txChar = ch;
                            }
                            if (!this.rxChar && (props.notify || props.indicate)) {
                                this.rxChar = ch;
                            }
                        }
                        if (this.txChar) break;
                    } catch (e) {}
                }
            }

            if (!this.txChar) {
                throw new Error("Kedi Mini yazıcı yazdırma kanalı (TX/FF02) bulunamadı.");
            }

            if (this.rxChar) {
                try {
                    await this.rxChar.startNotifications();
                    this.rxChar.addEventListener('characteristicvaluechanged', (e) => this._handleNotification(e));
                    console.log("✅ Kedi Mini bildirim kanalı aktif.");
                } catch (eNotif) {
                    console.warn("Kedi Mini bildirim açılamadı:", eNotif);
                }
            }

            const printerName = this.device.name || "Kedi Mini (C9 / GB01)";
            console.log("✅ Kedi Mini yazıcı bağlandı:", printerName);

            // Bağlantı kurulduğunda durum sorgula
            setTimeout(() => this.updateStatus(), 500);

            return printerName;
        } catch (error) {
            console.error("Kedi Mini sürücü hatası:", error);
            throw error;
        }
    }

    _crc(data) {
        let crc = 0;
        for (let i = 0; i < data.length; i++) {
            crc ^= data[i];
            for (let j = 0; j < 8; j++) {
                crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) & 0xFF : (crc << 1) & 0xFF;
            }
        }
        return crc;
    }

    _buildPacket(cmd, payload = []) {
        const p = (payload instanceof Uint8Array) ? payload : new Uint8Array(payload);
        const len = p.length;
        const packet = new Uint8Array(8 + len);
        packet[0] = 0x51;
        packet[1] = 0x78;
        packet[2] = cmd;
        packet[3] = 0x00;
        packet[4] = len & 0xFF;
        packet[5] = (len >> 8) & 0xFF;
        packet.set(p, 6);
        packet[6 + len] = this._crc(p);
        packet[7 + len] = 0xFF;
        return packet;
    }

    async _writeChunked(data, chunkSize = 20) {
        for (let i = 0; i < data.length; i += chunkSize) {
            const chunk = data.slice(i, i + chunkSize);
            await this.txChar.writeValueWithoutResponse(chunk);
            if (chunkSize <= 20) {
                await new Promise(r => setTimeout(r, 6));
            }
        }
    }

    async _send(cmd, payload = []) {
        if (!this.txChar) throw new Error("Yazıcı bağlantısı yok.");
        const pkt = this._buildPacket(cmd, payload);
        await this._writeChunked(pkt, 20);
    }

    _handleNotification(event) {
        const data = new Uint8Array(event.target.value.buffer);
        if (data.length < 6 || data[0] !== 0x51 || data[1] !== 0x78) return;

        const cmdId = data[2];
        const len = data[4] | (data[5] << 8);
        const payload = data.slice(6, 6 + len);

        if (cmdId === 0xA1 && payload.length > 0) {
            let battery = null;
            let noPaper = false;

            if (payload.length >= 10 && payload[9] <= 100 && payload[9] >= 0) {
                battery = payload[9];
            } else if (payload[0] <= 100 && payload[0] >= 0) {
                battery = payload[0];
            }

            if (payload.length >= 2 && payload[1] === 1) {
                noPaper = true;
            }

            if (battery !== null) this.batteryLevel = battery;

            if (typeof App !== 'undefined' && App.onPrinterStatus) {
                App.onPrinterStatus({
                    name: this.device ? this.device.name : 'Kedi Mini (C9)',
                    battery: battery,
                    noPaper: noPaper,
                    temp: null
                });
            }
        }
    }

    async updateStatus() {
        if (!this.txChar) return;
        try {
            // 0xA1: Durum & pil sorgulama
            await this._send(0xA1, [0x00]);
        } catch (e) {
            console.warn("CatPrinter updateStatus hatası:", e);
        }
    }

    async feedPaper(lines = 64) {
        if (!this.txChar) return;
        const l = Math.max(8, Math.min(800, parseInt(lines) || 64));
        try {
            // 0xBD: Kâğıt ilerletme (feed)
            await this._send(0xBD, [l & 0xFF, (l >> 8) & 0xFF]);
            await new Promise(r => setTimeout(r, 120));
        } catch (e) {
            console.warn("CatPrinter feedPaper hatası:", e);
        }
    }

    async print(bytes, h) {
        if (!this.txChar) throw new Error("Yazıcıya bağlantı yok.");

        // 1. Baskı yoğunluğunu ayarla (0xAF: 0x02 = koyu / derin siyah baskı)
        try {
            await this._send(0xAF, [0x02]);
            await new Promise(r => setTimeout(r, 20));
        } catch (e1) {}

        // 2. Kâğıt modu (0xBE: 0x00 = standart termal rulo)
        try {
            await this._send(0xBE, [0x00]);
            await new Promise(r => setTimeout(r, 20));
        } catch (e2) {}

        // 3. Raster satırlarını 48 baytlık (384 dot) paketler olarak gönder (0xA2)
        const bytesPerRow = 48;
        const rowBuf = new Uint8Array(bytesPerRow);

        for (let y = 0; y < h; y++) {
            const offset = y * bytesPerRow;
            for (let x = 0; x < bytesPerRow; x++) {
                let b = bytes[offset + x] || 0;
                // LSB (bit 0 sol) -> MSB (bit 7 sol) bit çevrimi
                rowBuf[x] = ((b * 0x0802 & 0x22110) | (b * 0x8020 & 0x88440)) * 0x10101 >> 16 & 0xFF;
            }

            const pkt = this._buildPacket(0xA2, rowBuf);
            await this._writeChunked(pkt, 20);

            // Her 8 satırda bir kısa nefes alma gecikmesi (BLE akış kontrolü)
            if (y % 8 === 0) {
                await new Promise(r => setTimeout(r, 12));
            }
        }

        // 4. Baskı bittikten sonra kâğıdı kesme bıçağını geçecek kadar ilerlet (72 satır feed)
        try {
            await this.feedPaper(72);
        } catch (eFeed) {}

        // Pil durumunu tazele
        setTimeout(() => this.updateStatus(), 1200);
    }
}

class UniversalPrinterDriver {
    constructor() {
        this.device = null;
        this.driver = null;
        this.drivers = {
            'cat_gb01': new CatPrinterDriver(),
            'lefuxin': new LefuxinDriver(),
            'escpos': new ESCPOSDriver(),
            'bleserial': new BLEProtocolDriver()
        };
    }

    async connect() {
        try {
            console.log("Yazıcı otomatik olarak algılanıyor...");
            
            const allServices = [
                // Lefuxin / MXW01 (0x2221)
                '0000ae30-0000-1000-8000-00805f9b34fb',
                '0000af30-0000-1000-8000-00805f9b34fb',
                '0000ae00-0000-1000-8000-00805f9b34fb',
                // Kedi Mini C9 / GB01 / WalkPrint / FunPrint (0x5178)
                '0000ff00-0000-1000-8000-00805f9b34fb',
                '0000fee7-0000-1000-8000-00805f9b34fb',
                '0000fff0-0000-1000-8000-00805f9b34fb',
                // ESC/POS
                '000018f0-0000-1000-8000-00805f9b34fb',
                '49535343-fe7d-4ae5-8fa9-9fafd205e455',
                '00001101-0000-1000-8000-00805f9b34fb',
                // BLE Serial
                '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
            ];
            
            this.device = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: allServices
            });

            const server = await this.device.gatt.connect();
            const services = await server.getPrimaryServices();
            const serviceUUIDs = services.map(s => s.uuid.toLowerCase());
            const devName = (this.device.name || "").toLowerCase();
            
            console.log("Bulunan servisler:", serviceUUIDs, "Cihaz adı:", devName);
            
            // Servislere ve cihaz adına göre doğru alt sürücüyü seç
            if (serviceUUIDs.includes('0000ae30-0000-1000-8000-00805f9b34fb') ||
                serviceUUIDs.includes('0000af30-0000-1000-8000-00805f9b34fb') ||
                serviceUUIDs.includes('0000ae00-0000-1000-8000-00805f9b34fb') ||
                devName.includes('mx') || devName.includes('lefuxin')) {
                this.driver = this.drivers.lefuxin;
                console.log("Algılanan protokol: Lefuxin / MXW01 (0x2221)");
            } else if (devName.includes('c9') || devName.includes('c15') || devName.includes('c17') ||
                       devName.includes('c19') || devName.includes('c21') || devName.includes('gb01') ||
                       devName.includes('walkprint') || devName.includes('funprint')) {
                this.driver = this.drivers.cat_gb01;
                console.log("Algılanan protokol: Kedi Mini C9 / GB01 / WalkPrint (0x5178)");
            } else if (serviceUUIDs.includes('49535343-fe7d-4ae5-8fa9-9fafd205e455') ||
                      serviceUUIDs.includes('000018f0-0000-1000-8000-00805f9b34fb') ||
                      serviceUUIDs.includes('00001101-0000-1000-8000-00805f9b34fb')) {
                this.driver = this.drivers.escpos;
                console.log("Algılanan protokol: ESC/POS");
            } else if (serviceUUIDs.includes('6e400001-b5a3-f393-e0a9-e50e24dcca9e')) {
                this.driver = this.drivers.bleserial;
                console.log("Algılanan protokol: BLE Serial");
            } else {
                // Güvenli varsayılan: MXW01 / Lefuxin
                this.driver = this.drivers.lefuxin;
                console.log("Varsayılan protokol: Lefuxin / MXW01");
            }
            
            // Kullanıcıya tekrar pencere açmadan mevcut bağlantıyı alt sürücüye aktar
            return await this.driver.connect(this.device);
            
        } catch (error) {
            console.error("Evrensel sürücü hatası:", error);
            throw error;
        }
    }

    async feedPaper(lines = 64) {
        if (!this.driver) throw new Error("Sürücü başlatılmadı.");
        if (typeof this.driver.feedPaper === 'function') {
            return await this.driver.feedPaper(lines);
        }
    }

    async print(bytes, h) {
        if (!this.driver) throw new Error("Sürücü başlatılmadı.");
        return await this.driver.print(bytes, h);
    }

    async updateStatus() {
        if (this.driver && typeof this.driver.updateStatus === 'function') {
            return await this.driver.updateStatus();
        }
    }
}

// Sanal / Simülasyon Sürücüsü (Testler için)
class FakeDriver {
    constructor() {
        this.battery = 92;
        this.noPaper = false;
        this.name = "Sanal Kedi Mini (Test)";
    }

    async connect() {
        return new Promise((resolve) => {
            setTimeout(() => {
                if (typeof App !== 'undefined' && App.onPrinterStatus) {
                    App.onPrinterStatus({
                        name: this.name,
                        battery: this.battery,
                        noPaper: this.noPaper,
                        temp: 28
                    });
                }
                resolve("Sanal Kedi Mini Test Yazıcısı");
            }, 600);
        });
    }

    async updateStatus() {
        if (typeof App !== 'undefined' && App.onPrinterStatus) {
            App.onPrinterStatus({
                name: this.name,
                battery: this.battery,
                noPaper: this.noPaper,
                temp: 29
            });
        }
    }

    async feedPaper(lines = 64) {
        console.log(`[FakePrint] Kâğıt ${lines} adım ilerletildi.`);
        const statusEl = document.getElementById('printStatus');
        if (statusEl) {
            const isEn = document.body.classList.contains('en-mode');
            statusEl.innerText = isEn ? `Paper fed (${lines} dots)` : `Kâğıt ilerletildi (${lines} px)`;
            setTimeout(() => {
                if (statusEl && statusEl.innerText.includes('ilerletildi')) statusEl.innerText = "";
            }, 2000);
        }
    }

    async print(bytes, h) {
        console.log(`[FakePrint] Yazdırma işlemi başlatıldı. Yükseklik: ${h}px, Boyut: ${bytes.length} bayt`);
        for (let i = 0; i <= 100; i += 20) {
            console.log(`[FakePrint] İlerleme: %${i}`);
            await new Promise(r => setTimeout(r, 150));
        }
        console.log("[FakePrint] Yazdırma başarıyla tamamlandı!");
        if (this.battery > 5) this.battery -= 1;
        this.updateStatus();
    }
}

const PrinterRegistry = {
    "mxw01": { 
        name: "🐱 MXW01 / Lefuxin (Standart / Varsayılan)", 
        driver: new LefuxinDriver() 
    },
    "universal": { 
        name: "🐾 Otomatik Algılama (Evrensel)", 
        driver: new UniversalPrinterDriver() 
    },
    "cat_gb01": { 
        name: "🐱 C9 / WalkPrint / FunPrint (0x5178)", 
        driver: new CatPrinterDriver() 
    },
    "escpos": { 
        name: "🖨️ XPrinter / Sunmi / Bixolon (ESC/POS)", 
        driver: new ESCPOSDriver() 
    },
    "bleserial": { 
        name: "📶 HMSoft / ZH03 (BLE Serial)", 
        driver: new BLEProtocolDriver() 
    },
    "fake": { 
        name: "🧪 Öykünme (Test / Simülatör)", 
        driver: new FakeDriver() 
    }
};