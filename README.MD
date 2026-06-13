# CD COMIC READER
Local display images in comic style

Một ứng dụng máy tính (Desktop App) gọn nhẹ giúp đọc truyện tranh từ các thư mục ảnh cục bộ (local) theo phong cách cuộn dọc tiện lợi.

---

## 🚀 Tính năng nổi bật
* **Đọc truyện kiểu Comic/Webtoon:** Tự động tối ưu hóa hiển thị hình ảnh theo dạng cuộn dọc liên tục, mang lại trải nghiệm mượt mà.
* **Tìm kiếm thông minh:** Quản lý và tìm kiếm nhanh chóng các bộ truyện hoặc chương truyện trong thư mục máy tính của bạn.
* **Tối ưu hiệu năng:** Xử lý và hiển thị danh sách ảnh cục bộ mượt mà, không gây tràn bộ nhớ.

---

## 🛠️ Công nghệ sử dụng
* **Frontend/Backend:** Electron, Node.js (kết hợp sức mạnh của giao diện web và khả năng truy cập hệ thống file của desktop)
* **Quản lý gói:** npm

---

## 📦 Hướng dẫn cài đặt & Chạy dự án

### 1. Yêu cầu hệ thống
Máy tính của bạn cần cài đặt sẵn **Node.js** (khuyến nghị phiên bản LTS mới nhất).

### 2. Các bước thực hiện
Cài đặt các thư viện phụ thuộc từ file `package.json`:
```bash
npm install

```

Chạy ứng dụng ở chế độ phát triển (Development mode):

```bash
npm start

```

Đóng gói ứng dụng thành file cài đặt (khi hoàn thiện):

```bash
npm run build

```

---

## ⌨️ Phím tắt cơ bản (Hotkeys)

* `Mũi tên Xuống / Space`: Cuộn xuống dưới.
* `Mũi tên Lên`: Cuộn lên trên.
* `F11`: Bật/Tắt chế độ toàn màn hình (Fullscreen).
* `Ctrl + R` (hoặc `Cmd + R` trên macOS): Tải lại ứng dụng.

---

## 📂 Cấu trúc thư mục dự án

Nhìn vào sơ đồ cây thư mục (như trong ảnh `image_ee7921.png`), dự án được tổ chức như sau:

* `src/`: Nơi chứa toàn bộ mã nguồn của ứng dụng (Main process và Renderer process).
* `node_modules/`: Thư mục chứa các dependency của Node.js (đã được cấu hình bỏ qua trong `.gitignore`).
* `package.json`: Chứa thông tin cấu hình dự án, scripts chạy và danh sách thư viện sử dụng.

```

---

### Giải thích logic tổ chức file README
* **Phần mở đầu:** Giới thiệu ngắn gọn nhưng đủ ý về mục đích của phần mềm (đọc ảnh local dạng comic).
* **Tính năng & Công nghệ:** Tập trung vào các điểm chính như Electron và tính năng cuộn dọc/tìm kiếm để định hình rõ kiến trúc dự án.
* **Hướng dẫn cài đặt:** Sử dụng các khối lệnh chuẩn (`npm install`, `npm start`) giúp bất kỳ ai khi tải code từ GitHub về đều có thể chạy được ngay lập tức mà không cần mò mẫm.