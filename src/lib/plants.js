export function defaultPlants() {
  const plants = [];
  for (const zone of ['A', 'B', 'C', 'D']) {
    for (let row = 1; row <= 3; row += 1) {
      for (let position = 1; position <= 5; position += 1) {
        const plantId = `${zone}-${row}-${position}`;
        plants.push({
          plantId,
          dataHubDeviceId: plantId,
          zone,
          row: String(row),
          position: String(position),
          enabled: true
        });
      }
    }
  }
  return plants;
}
