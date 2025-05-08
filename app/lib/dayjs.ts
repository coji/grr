import dayjs from 'dayjs'

import utc from 'dayjs/plugin/utc'
dayjs.extend(utc)

import timezone from 'dayjs/plugin/timezone'
dayjs.extend(timezone)

import isSameOrAfter from 'dayjs/plugin/isSameOrAfter'
dayjs.extend(isSameOrAfter)

import ja from 'dayjs/locale/ja'
dayjs.locale(ja)

export default dayjs
