package com.clikgate.model;

/** QR code bytes and their content type ({@code image/svg+xml} or {@code image/png}); also the generated layer's binary result. */
public final class QrCode {
  private final String contentType;
  private final byte[] data;

  public QrCode(String contentType, byte[] data) {
    this.contentType = contentType;
    this.data = data.clone();
  }

  public String getContentType() {
    return contentType;
  }

  public byte[] getData() {
    return data.clone();
  }
}
