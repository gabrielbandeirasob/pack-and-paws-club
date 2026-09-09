import { Link } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import type { ComponentProps } from 'react';
import { Platform } from 'react-native';

export function ExternalLink(props: ComponentProps<typeof Link>) {
  return (
    <Link
      target="_blank"
      {...props}
      onPress={(e) => {
        props.onPress?.(e);
        if (Platform.OS !== 'web' && !e.defaultPrevented) {
          // Prevent the default behavior of linking to the default browser on native.
          e.preventDefault();
          // Open the link in an in-app browser.
          WebBrowser.openBrowserAsync(String(props.href));
        }
      }}
    />
  );
}
