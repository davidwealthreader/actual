import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { ButtonWithLoading } from '@actual-app/components/button';
import { InitialFocus } from '@actual-app/components/initial-focus';
import { Input } from '@actual-app/components/input';
import { Text } from '@actual-app/components/text';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';

import { Error as ErrorAlert } from '#components/alerts';
import { Link } from '#components/common/Link';
import {
  Modal,
  ModalButtons,
  ModalCloseButton,
  ModalHeader,
} from '#components/common/Modal';
import { FormField, FormLabel } from '#components/forms';
import type { Modal as ModalType } from '#modals/modalsSlice';
import { getSecretsError } from '#util/error';

type WealthReaderInitialiseProps = Extract<
  ModalType,
  { name: 'wealthreader-init' }
>['options'];

export function WealthReaderInitialiseModal({
  onSuccess,
}: WealthReaderInitialiseProps) {
  const { t } = useTranslation();
  const [apiKey, setApiKey] = useState('');
  const [isValid, setIsValid] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(
    t('It is required to provide a Wealth Reader API key.'),
  );

  const redirectUrl = `${window.location.origin}/wealthreader/auth_callback`;

  async function onSubmit(close: () => void) {
    if (!apiKey) {
      setIsValid(false);
      setError(t('It is required to provide a Wealth Reader API key.'));
      return;
    }

    setIsLoading(true);

    try {
      const result = await send('wealthreader-configure', { apiKey });

      if (result?.error) {
        setIsValid(false);
        setError(getSecretsError(result.error, result.reason));
        return;
      }

      if (result?.data?.error_code) {
        setIsValid(false);
        setError(
          result.data.error_type ||
            t('Could not save the API key. Please try again.'),
        );
        return;
      }

      setIsValid(true);
      onSuccess();
      close();
    } catch {
      setIsValid(false);
      setError(t('Could not save the API key. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Modal
      name="wealthreader-init"
      containerProps={{ style: { width: '30vw', minWidth: 420 } }}
    >
      {({ state }) => (
        <>
          <ModalHeader
            title={t('Set up Wealth Reader')}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <View style={{ display: 'flex', gap: 10 }}>
            <Text>
              <Trans>
                Bank sync via Wealth Reader uses your own API key. Create one at{' '}
                <Link
                  variant="external"
                  to="https://www.wealthreader.com/docs/en/oauth-backend/"
                  linkColor="purple"
                >
                  Wealth Reader
                </Link>{' '}
                and register this redirect URL with access_type=oauth and
                tokenize=1:
              </Trans>
            </Text>
            <code>{redirectUrl}</code>

            <FormField>
              <FormLabel title={t('API key:')} htmlFor="wealthreader-api-key" />
              <InitialFocus>
                <Input
                  id="wealthreader-api-key"
                  type="password"
                  value={apiKey}
                  onChangeValue={value => {
                    setApiKey(value);
                    setIsValid(true);
                  }}
                />
              </InitialFocus>
            </FormField>

            {!isValid && <ErrorAlert>{error}</ErrorAlert>}
          </View>

          <ModalButtons>
            <ButtonWithLoading
              variant="primary"
              isLoading={isLoading}
              onPress={() => {
                void onSubmit(() => state.close());
              }}
            >
              <Trans>Save and continue</Trans>
            </ButtonWithLoading>
          </ModalButtons>
        </>
      )}
    </Modal>
  );
}
