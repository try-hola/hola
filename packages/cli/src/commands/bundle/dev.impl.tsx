import React from 'react';
import { render, Text, Box } from 'ink';

export async function runBundleDev() {
  const ui = render(
    <Box flexDirection="column">
      <Text color="yellow">Development session features have been simplified.</Text>
      <Text></Text>
      <Text>The dev session API has been removed to reduce API complexity.</Text>
      <Text>Please use the standard draft and deployment workflow instead:</Text>
      <Text></Text>
      <Text color="cyan">1. hola draft create --from-bundle</Text>
      <Text color="cyan">2. hola draft validate</Text>
      <Text color="cyan">3. hola deploy create --from-draft</Text>
      <Text></Text>
      <Text color="gray">This provides the same functionality with a cleaner API surface.</Text>
    </Box>
  );
  
  setTimeout(() => {
    ui.unmount();
  }, 5000);
}
