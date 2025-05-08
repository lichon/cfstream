import { useEffect } from 'react';
import QRCode from 'qrcode';
import styled from 'styled-components';

interface QROverlayProps {
  url: string;
  show: boolean;
  onClose: () => void;
}

// 使用 styled-components 定义样式
const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1001;
`;

const Container = styled.div`
  background: white;
  padding: 1rem;
  border-radius: 0.5rem;
  text-align: center;
`;

const Description = styled.p`
  margin: 0;
  color: #666;
  font-size: 14px;
`;

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
    <Overlay onClick={onClose}>
      <Container>
        <canvas id="qrCode"></canvas>
        <Description>Click anywhere to close</Description>
      </Container>
    </Overlay>
  );
};

export default QROverlay