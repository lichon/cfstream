import React from 'react'

interface VideoContainerProps {
  videoRef: React.RefObject<HTMLVideoElement | null>
  isMoblie: boolean
  onClick?: () => void
}

const StreamVideo: React.FC<VideoContainerProps> = ({ videoRef, isMoblie, onClick }) => (
  <div className="fixed inset-0 overflow-hidden">
    <video
      muted
      autoPlay
      playsInline
      ref={(video) => {
        videoRef.current = video
        if (video) {
          let playTriggered = Date.now()
          video.disablePictureInPicture = false
          video.playsInline = true
          video.onplay = () => {
            playTriggered = Date.now()
            video.controls = false
          }
          video.onclick = () => {
            onClick?.()
            if (!isMoblie) return
            if (video.paused) {
              video.controls = false
              video.play()
            } else if (Date.now() - playTriggered > 100) {
              video.controls = true
              video.pause()
            }
          }
        }
      }}
      onDoubleClick={(ev) => {
        const video = ev.target as HTMLVideoElement
        if (!video.src && !video.srcObject) {
          return
        }
        if (!document.fullscreenElement) {
          video.requestFullscreen()
        } else {
          document.exitFullscreen()
        }
      }}
      className="absolute top-0 left-0 w-full h-full"
    ></video>
  </div>
)

export default StreamVideo