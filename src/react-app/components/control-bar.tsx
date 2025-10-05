import React from 'react'

// Button definition exported so callers can build arrays easily
export interface ControlBarButton {
  label: React.ReactNode   // Text shown on the button
  title?: string           // Standard title tooltip
  onClick?: () => void      // Click handler
  disabled?: boolean       // Optional disabled state
  active?: boolean         // Optional active state for styling
  id?: string              // Optional stable id / test id
  menu?: {                  // Optional dropdown menu configuration
    items: ControlBarMenuItem[] // Items to display
    openOn?: 'hover' | 'click'  // Default: hover
    align?: 'left' | 'right'    // Default: left
  }
  className?: string       // Custom class names for the button
}

export interface ControlBarMenuItem {
  label: string
  onClick?: () => void
  id?: string
  disabled?: boolean
}

export interface ControlBarProps {
  buttons: ControlBarButton[]         // Provide 3 or more buttons
  className?: string                  // Extra class names for outer wrapper
  orientation?: 'horizontal' | 'vertical'
  gap?: number                        // Gap (px) between buttons (default 8)
  style?: React.CSSProperties         // Style override
}

// Lightweight control bar based on a button group concept.
// Tailwind CSS version (removed most inline styling in favor of utility classes)
export const ControlBar: React.FC<ControlBarProps> = ({
  buttons = [],
  className = '',
  orientation = 'horizontal',
  gap = 8,
  style
}) => {
  const flexDirection = orientation === 'horizontal' ? 'row' : 'column'

  // Track which button (id or generated key) is currently hovered to apply hover config
  const [openMenuKey, setOpenMenuKey] = React.useState<string | null>(null)

  const closeMenu = React.useCallback(() => setOpenMenuKey(null), [])

  React.useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      // Close if clicking outside an open menu
      if (openMenuKey) {
        const target = e.target as HTMLElement
        if (!target.closest('[data-control-bar] [data-has-menu]')) {
          closeMenu()
        }
      }
    }
    if (openMenuKey) document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [openMenuKey, closeMenu])

  const handleButtonKeyDown = (e: React.KeyboardEvent, key: string, btn: ControlBarButton) => {
    if (!btn.menu) return
    if (['ArrowDown', 'Enter', ' '].includes(e.key)) {
      e.preventDefault()
      setOpenMenuKey(prev => prev === key ? null : key)
    } else if (e.key === 'Escape') {
      if (openMenuKey) {
        e.preventDefault()
        closeMenu()
      }
    }
  }

  // Centralized shared styling so menu items reuse button defaults
  const sharedButtonBase = 'px-4 py-2 rounded-lg leading-tight font-medium transition-colors duration-150 select-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
  const sharedColorDefault = 'bg-neutral-900 text-white hover:bg-neutral-700 active:bg-neutral-800 focus:outline-none'
  const sharedWrapStyle = 'whitespace-nowrap overflow-y-auto'

  const renderMenu = (btn: ControlBarButton, key: string) => {
    if (!btn.menu) return null
    const open = openMenuKey === key
    if (!open) return null
    const alignRight = btn.menu.align === 'right'
    return (
      <ul
        role="menu"
        aria-label={typeof btn.label === 'string' ? btn.label : undefined}
        data-menu
        className={`absolute top-full min-w-[140px] rounded-lg bg-neutral-900 shadow-lg shadow-black/40 py-1 z-20 overflow-hidden ${alignRight ? 'right-0' : 'left-0'}`}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            closeMenu()
          }
        }}
      >
        {btn.menu.items.map((item, i) => {
          const liClasses = [
            'inline-flex w-full text-left',
            sharedButtonBase,
            sharedColorDefault,
            sharedWrapStyle
          ].join(' ')
          return (
            <li
              role="menuitem"
              key={item.id || `${key}_item_${i}`}
              aria-disabled={item.disabled || undefined}
              tabIndex={-1}
              className={liClasses}
              onClick={(e) => {
                e.stopPropagation()
                if (!item.disabled) item.onClick?.()
                closeMenu()
              }}
            >
              {item.label}
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div
      role="toolbar"
      aria-orientation={orientation}
      className={`control-bar ${orientation} flex ${orientation === 'horizontal' ? 'flex-row' : 'flex-col'} items-center ${className}`.trim()}
      style={{ flexDirection, gap, ...style }}
      data-control-bar
    >
      {buttons.map((btn, idx) => {
        const key = btn.id || `${btn.label || 'btn'}_${idx}`
        const ariaPressed = btn.active ? true : undefined
        const hasMenu = !!btn.menu
        const open = openMenuKey === key
        const openOn = btn.menu?.openOn || 'hover'

        // Default fallback styling classes
        const defaultClasses = [
          'control-bar__button relative inline-flex',
          sharedButtonBase,
          sharedColorDefault,
          sharedWrapStyle,
          'aria-[pressed=true]:ring-1 aria-[pressed=true]:ring-blue-400',
          btn.className || ''
        ]

        // Removed baseClass override logic
        const baseClasses = defaultClasses.filter(Boolean).join(' ')

        return (
          <div
            key={key}
            className="relative inline-flex"
            data-has-menu={hasMenu || undefined}
            onMouseLeave={() => {
              if (openOn === 'hover' && open) closeMenu()
            }}
            onMouseEnter={() => {
              if (hasMenu && openOn === 'hover') setOpenMenuKey(key)
            }}
          >
            <button
              id={btn.id}
              type="button"
              onClick={() => {
                if (btn.disabled) return
                if (hasMenu && openOn === 'click') {
                  setOpenMenuKey(cur => cur === key ? null : key)
                } else {
                  btn.onClick?.()
                }
              }}
              disabled={btn.disabled}
              aria-pressed={ariaPressed}
              className={baseClasses}
              aria-haspopup={hasMenu ? 'menu' : undefined}
              aria-expanded={hasMenu ? open : undefined}
              onKeyDown={(e) => handleButtonKeyDown(e, key, btn)}
              title={btn.title}
            >
              {btn.label || '\u00A0'}
              {hasMenu && (
                <span className="ml-1 inline-block opacity-70">▾</span>
              )}
            </button>
            {renderMenu(btn, key)}
          </div>
        )
      })}
    </div>
  )
}

export default ControlBar
