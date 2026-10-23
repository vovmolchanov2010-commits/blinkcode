// react-native-maps нужна только в Expo Go (там она уже встроена). В сборку приложения
// её не линкуем: на Android ей нужен ключ Google Maps, без него приложение падало.
// В установленном приложении карта — MapLibre (src/ui/map).
module.exports = {
  dependencies: {
    'react-native-maps': { platforms: { android: null, ios: null } },
  },
};
