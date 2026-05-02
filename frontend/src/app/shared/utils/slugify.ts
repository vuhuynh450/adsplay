/**
 * Converts a string into a URL-friendly slug.
 * Example: "Màn Hình Sảnh" -> "manhinhsanh"
 */
export function slugify(str: string): string {
    if (!str) return '';
    return str
        .toLowerCase()
        // Replace Vietnamese characters
        .replace(/a|á|à|ả|ã|ạ|ă|ắ|ằ|ẳ|ẵ|ặ|â|ấ|ầ|ẩ|ẫ|ậ/gi, 'a')
        .replace(/e|é|è|ẻ|ẽ|ẹ|ê|ế|ề|ể|ễ|ệ/gi, 'e')
        .replace(/i|í|ì|ỉ|ĩ|ị/gi, 'i')
        .replace(/o|ó|ò|ỏ|õ|ọ|ô|ố|ồ|ổ|ỗ|ộ|ơ|ớ|ờ|ở|ỡ|ợ/gi, 'o')
        .replace(/u|ú|ù|ủ|ũ|ụ|ư|ứ|ừ|ử|ữ|ự/gi, 'u')
        .replace(/y|ý|ỳ|ỷ|ỹ|ỵ/gi, 'y')
        .replace(/d|đ/gi, 'd')
        // Remove special characters, keep alphanumeric and spaces
        .replace(/[^a-z0-9\s]/g, '')
        // Remove all spaces to create a continuous string
        .replace(/\s+/g, '')
        // Trim just in case
        .trim();
}
