import { setupInkApp, type UI } from './App.js'

export const setupUI = async (ui?: UI) => {
  return await setupInkApp(ui)
}
