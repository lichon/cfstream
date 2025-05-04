import { useEffect } from 'react'
import QRCode from 'qrcode'

interface QROverlayProps {
  url: string
  show: boolean
  onClose: () => void
}

const QROverlay = ({ url, show, onClose }: QROverlayProps) => {
  useEffect(() => {
    if (!show) return

    const generateQR = async () => {
      try {
        const canvas = document.getElementById('qrCode') as HTMLCanvasElement
        await QRCode.toCanvas(canvas, url, {
          width: 240,
          margin: 0
        })
      } catch (err) {
        console.error('Error generating QR code:', err)
      }
    }
    
    generateQR()
  }, [url, show])

  if (!show) return null

  return (
    <div className='qr-overlay' onClick={onClose}>
      <div className='qr-container'>
        <canvas id='qrCode'></canvas>
        <p>Click anywhere to close</p>
      </div>
    </div>
  )
}

export default QROverlay