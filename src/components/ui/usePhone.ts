'use client'
// phones: a coarse pointer on a narrow screen. links get texted, so the site has to work there
import { useEffect, useState } from 'react'

const QUERY = '(pointer: coarse) and (max-width: 820px)'
export const isPhoneNow = () => typeof window !== 'undefined' && window.matchMedia?.(QUERY).matches

export function usePhone() {
  const [phone, setPhone] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const on = () => setPhone(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return phone
}
