# HLS-only Storage Design

## Muc tieu

Mac dinh luu video theo che do HLS khong tai ma hoa: he thong chi chia video nguon thanh HLS, sau do xoa file nguon de tranh nhan doi dung luong va giu nguyen chat luong hinh anh.

## Pham vi

- Moi video upload hop le mac dinh dung `hls-only`; khong hien tuy chon HLS da tai ma hoa trong giao dien upload.
- `hls-only` tao HLS bang stream copy, chi xoa file nguon sau khi playlist va tat ca segment da tao thanh cong.
- Player mac dinh phat HLS cho video; khong thu fallback sang MP4.
- Cac endpoint/giao dien dang dung MP4 se nhan biet video chi co HLS va khong yeu cau file nguon da xoa.

## Xu ly media

1. Luu file upload tam thoi nhu nguon nhu hien tai va dung ffprobe kiem tra codec.
2. Chi chap nhan nguon H.264 video va AAC (hoac khong co) audio. Codec khac bi tu choi truoc khi tao video record hoac dua vao playlist, voi thong bao yeu cau chuyen doi sang H.264/AAC; file upload tam thoi bi xoa.
3. Tao HLS bang FFmpeg voi video va audio stream copy, khong dung scale, CRF, bitrate limit hoac codec re-encode.
4. Xac minh `playlist.m3u8` ton tai va co it nhat mot segment truoc khi cap nhat metadata.
5. Cap nhat video thanh `hls-only`, luu duong dan manifest va thong tin media probe duoc.
6. Xoa file nguon sau khi cap nhat metadata thanh cong. Neu xoa that bai, giu HLS va danh dau can don dep file nguon, khong huy HLS da hop le.
7. Neu probe, tao HLS, xac minh artifact, hoac cap nhat metadata that bai, giu file nguon va danh dau loi xu ly; khong xoa du lieu duy nhat.

## Phat va API

- Video chi co nguon phat HLS.
- Player phat HLS va khong fallback MP4.
- Endpoint `/api/videos/:id/stream` tra loi ro rang rang MP4 khong kha dung cho video chi co HLS, thay vi tra 404 file missing.
- Giao dien admin khong hien thi hoac khong goi lien ket MP4 cho video chi co HLS.
- Xoa video xoa thu muc HLS; xoa file nguon neu con ton tai de tuong thich voi cac video cu.

## Tuong thich va gioi han

- Stream copy chi phat on dinh tren cac trinh duyet dich khi codec nguon tuong thich, uu tien H.264 video va AAC audio.
- Video co codec khong tuong thich bi tu choi va file upload tam thoi duoc xoa; he thong khong luu video khong the phat.
- Che do nay khong phai adaptive bitrate: mang yeu van can tai bitrate goc va co the buffering.
- Video da upload truoc thay doi giu nguyen du lieu va hanh vi hien tai.

## Kiem thu

- Test xu ly `hls-only` xac nhan FFmpeg khong tai ma hoa, manifest/segment ton tai, va file nguon bi xoa sau khi hoan tat.
- Test loi tao HLS xac nhan file nguon duoc giu lai.
- Test upload video co codec khong tuong thich bi tu choi, tra thong bao chuyen doi sang H.264/AAC, va xoa file tam.
- Test API stream cua `hls-only` tra ma loi co chu dich.
- Test player khong fallback MP4 khi HLS cua video `hls-only` gap loi.
- Chay toan bo test backend va frontend lien quan.
