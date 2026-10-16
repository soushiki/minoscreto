import { screen } from '@testing-library/react';

/** Llega a las herramientas por la guía: Proteger › Corto › Ver primero un ejemplo. */
export async function goToTools(user) {
  await user.click(screen.getByRole('button', { name: /Proteger un documento/ }));
  await user.click(screen.getByRole('button', { name: /^Corto/ }));
  await user.click(screen.getByRole('button', { name: 'Ver primero un ejemplo' }));
}
