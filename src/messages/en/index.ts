// Assembled dictionary for the `en` locale.
//
// Adding a namespace = add the .json file + one line here (and the mirror in
// the other locale — the parity test in src/__tests__/i18n-messages.test.ts
// fails the build otherwise). Adding a locale = copy this directory.
import admin from './admin.json'
import auth from './auth.json'
import center from './center.json'
import common from './common.json'
import email from './email.json'
import errors from './errors.json'
import publicMessages from './public.json'
import staff from './staff.json'
import student from './student.json'
import teacher from './teacher.json'
import terms from './terms.json'

const messages = { common, terms, admin, teacher, student, email, auth, center, staff, public: publicMessages, errors }

export default messages
