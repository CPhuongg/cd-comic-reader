Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $root 'assets'
$pngPath = Join-Path $assets 'icon.png'
$icoPath = Join-Path $assets 'icon.ico'
New-Item -ItemType Directory -Force -Path $assets | Out-Null

$size = 512
$bitmap = [System.Drawing.Bitmap]::new($size, $size)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$graphics.Clear([System.Drawing.Color]::FromArgb(20, 20, 22))

$white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(244, 244, 240))
$paper = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(220, 222, 218))
$amber = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(232, 168, 58))
$blue = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(104, 164, 224))
$dark = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(28, 28, 31))

$leftPage = [System.Drawing.PointF[]]@(
  [System.Drawing.PointF]::new(72, 116),
  [System.Drawing.PointF]::new(244, 145),
  [System.Drawing.PointF]::new(244, 402),
  [System.Drawing.PointF]::new(72, 366)
)
$rightPage = [System.Drawing.PointF[]]@(
  [System.Drawing.PointF]::new(268, 145),
  [System.Drawing.PointF]::new(440, 116),
  [System.Drawing.PointF]::new(440, 366),
  [System.Drawing.PointF]::new(268, 402)
)
$graphics.FillPolygon($paper, $leftPage)
$graphics.FillPolygon($white, $rightPage)
$graphics.FillRectangle($amber, 244, 144, 24, 260)
$graphics.FillRectangle($blue, 92, 142, 18, 194)

$font = [System.Drawing.Font]::new('Segoe UI', 102, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$format = [System.Drawing.StringFormat]::new()
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$graphics.DrawString('CD', $font, $dark, [System.Drawing.RectangleF]::new(118, 176, 292, 142), $format)

$iconBitmap = [System.Drawing.Bitmap]::new(256, 256)
$iconGraphics = [System.Drawing.Graphics]::FromImage($iconBitmap)
$iconGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$iconGraphics.DrawImage($bitmap, 0, 0, 256, 256)
$iconBitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$iconGraphics.Dispose()
$iconBitmap.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
$white.Dispose()
$paper.Dispose()
$amber.Dispose()
$blue.Dispose()
$dark.Dispose()
$font.Dispose()
$format.Dispose()

$pngBytes = [System.IO.File]::ReadAllBytes($pngPath)
$stream = [System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create)
$writer = [System.IO.BinaryWriter]::new($stream)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]1)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]32)
$writer.Write([UInt32]$pngBytes.Length)
$writer.Write([UInt32]22)
$writer.Write($pngBytes)
$writer.Dispose()
$stream.Dispose()

Write-Output "Generated $pngPath and $icoPath"
