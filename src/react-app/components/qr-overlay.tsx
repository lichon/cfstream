import { useEffect } from 'react';
import QRCode from 'qrcode';

interface QROverlayProps {
  url: string;
  show: boolean;
  onClose: () => void;
}

const QROverlay = ({ url, show, onClose }: QROverlayProps) => {
  useEffect(() => {
    if (!show) return;

    const generateQR = async () => {
      try {
        const canvas = document.getElementById('qrCode') as HTMLCanvasElement;
        await QRCode.toCanvas(canvas, url, {
          width: 240,
          margin: 0
        });
      } catch (err) {
        console.error('Error generating QR code:', err);
      }
    };

    generateQR();
  }, [url, show]);

  if (!show) return null;

  return (
    <div
      className="fixed inset-0 bg-black/70 flex justify-center items-center z-[1001]"
      onClick={onClose}
    >
      <div
        className="bg-white p-4 pb-0 rounded-lg text-center"
        onClick={e => e.stopPropagation()}
      >
        <canvas id="qrCode"></canvas>
        <p className="m-0 text-gray-500 text-sm">Click anywhere to close</p>
      </div>
    </div>
  );
};

export default QROverlay;