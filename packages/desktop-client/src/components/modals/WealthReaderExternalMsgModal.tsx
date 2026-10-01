import React, { useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { AnimatedLoading } from '@actual-app/components/icons/AnimatedLoading';
import { Paragraph } from '@actual-app/components/paragraph';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { sendCatch } from '@actual-app/core/platform/client/connection';
import type { SyncServerWealthReaderAccount } from '@actual-app/core/types/models';

import { Error, Warning } from '#components/alerts';
import { Autocomplete } from '#components/autocomplete/Autocomplete';
import { Link } from '#components/common/Link';
import { Modal, ModalCloseButton, ModalHeader } from '#components/common/Modal';
import { FormField, FormLabel } from '#components/forms';
import { COUNTRY_OPTIONS } from '#components/util/countries';
import { getCountryFromBrowser } from '#components/util/localeToCountry';
import { useGlobalPref } from '#hooks/useGlobalPref';
import { useWealthReaderStatus } from '#hooks/useWealthReaderStatus';
import { pushModal } from '#modals/modalsSlice';
import type { Modal as ModalType } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

type BankOption = {
  id: string;
  name: string;
};

function useAvailableBanks(
  country: string | undefined,
  refetchKey?: boolean | null,
) {
  const [banks, setBanks] = useState<BankOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetch() {
      setIsError(false);

      if (!country) {
        if (!cancelled) {
          setBanks([]);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);

      const { data, error } = await sendCatch(
        'wealthreader-entities',
        country.toUpperCase(),
      );

      if (cancelled) return;

      if (error) {
        setIsError(true);
        setBanks([]);
      } else {
        const entities = (data?.entities ?? data ?? []) as Array<{
          code: string;
          name: string;
        }>;
        setBanks(
          (Array.isArray(entities) ? entities : []).map(entity => ({
            id: entity.code,
            name: entity.name,
          })),
        );
      }

      setIsLoading(false);
    }

    void fetch();
    return () => {
      cancelled = true;
    };
  }, [country, refetchKey]);

  return {
    data: banks,
    isLoading,
    isError,
  };
}

function renderError(
  error: { code: 'unknown' | 'timeout'; message?: string },
  t: ReturnType<typeof useTranslation>['t'],
) {
  return (
    <Error style={{ alignSelf: 'center', marginBottom: 10 }}>
      {error.code === 'timeout'
        ? t('Timed out. Please try again.')
        : t(
            'An error occurred while linking your account, sorry! The potential issue could be: {{ message }}',
            { message: error.message },
          )}
    </Error>
  );
}

type WealthReaderExternalMsgModalProps = Extract<
  ModalType,
  { name: 'wealthreader-external-msg' }
>['options'];

export function WealthReaderExternalMsgModal({
  onMoveExternal,
  onSuccess,
  onClose,
}: WealthReaderExternalMsgModalProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const [language] = useGlobalPref('language');

  const browserTimezone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const browserLocale = language || navigator.language || 'en-US';
  const detectedCountry = getCountryFromBrowser(
    browserTimezone,
    browserLocale,
    COUNTRY_OPTIONS,
  );

  const [waiting, setWaiting] = useState<string | null>(null);
  const [selectedBank, setSelectedBank] = useState<string>();
  const [country, setCountry] = useState<string | undefined>(detectedCountry);
  const [error, setError] = useState<{
    code: 'unknown' | 'timeout';
    message?: string;
  } | null>(null);
  const [isWealthReaderSetupComplete, setIsWealthReaderSetupComplete] =
    useState<boolean | null>(null);
  const data = useRef<{ accounts: SyncServerWealthReaderAccount[] } | null>(
    null,
  );

  const {
    data: bankOptions,
    isLoading: isBankOptionsLoading,
    isError: isBankOptionError,
  } = useAvailableBanks(country, isWealthReaderSetupComplete);
  const {
    configuredWealthReader: isConfigured,
    isLoading: isConfigurationLoading,
  } = useWealthReaderStatus();

  const isJumpingRef = useRef(false);
  const stateRef = useRef<string | null>(null);
  const jumpIdRef = useRef(0);

  async function handleClose() {
    if (stateRef.current !== null) {
      await sendCatch('wealthreader-poll-auth-stop', {
        state: stateRef.current,
      });
    }
    onClose?.();
  }

  async function onJump() {
    const myJumpId = ++jumpIdRef.current;

    if (isJumpingRef.current) {
      if (stateRef.current !== null) {
        await sendCatch('wealthreader-poll-auth-stop', {
          state: stateRef.current,
        });
      }
      isJumpingRef.current = false;
    }
    isJumpingRef.current = true;

    try {
      setError(null);
      setWaiting('browser');

      if (!selectedBank) return;

      const res = await onMoveExternal({
        entityCode: selectedBank,
        onStateReady: state => {
          if (myJumpId === jumpIdRef.current) {
            stateRef.current = state;
          }
        },
      });

      if (myJumpId !== jumpIdRef.current) return;

      if ('error' in res) {
        setError({
          code: res.error,
          message: 'message' in res ? res.message : undefined,
        });
        setWaiting(null);
        return;
      }

      data.current = res.data;
      setWaiting('accounts');
      await onSuccess(data.current);
      if (myJumpId !== jumpIdRef.current) return;
      setWaiting(null);
    } finally {
      if (myJumpId === jumpIdRef.current) {
        isJumpingRef.current = false;
        stateRef.current = null;
      }
    }
  }

  const onWealthReaderInit = () => {
    dispatch(
      pushModal({
        modal: {
          name: 'wealthreader-init',
          options: {
            onSuccess: () => setIsWealthReaderSetupComplete(true),
          },
        },
      }),
    );
  };

  const renderLinkButton = () => {
    return (
      <View style={{ gap: 10 }}>
        <FormField>
          <FormLabel
            title={t('Choose your country:')}
            htmlFor="wr-country-field"
          />
          <Autocomplete
            strict
            highlightFirst
            suggestions={COUNTRY_OPTIONS}
            onSelect={value => {
              setCountry(value);
              setSelectedBank(undefined);
            }}
            value={country}
            inputProps={{
              id: 'wr-country-field',
              placeholder: t('(please select)'),
            }}
          />
        </FormField>

        {isBankOptionError ? (
          <Error>
            <Trans>
              Failed loading available banks: Wealth Reader credentials might be
              misconfigured. Please{' '}
              <Link
                variant="text"
                onClick={onWealthReaderInit}
                style={{ color: theme.formLabelText, display: 'inline' }}
              >
                set them up
              </Link>{' '}
              again.
            </Trans>
          </Error>
        ) : (
          country &&
          (isBankOptionsLoading ? (
            t('Loading banks...')
          ) : (
            <FormField>
              <FormLabel
                title={t('Choose your bank:')}
                htmlFor="wr-bank-field"
              />
              <Autocomplete
                focused
                strict
                highlightFirst
                suggestions={bankOptions}
                onSelect={setSelectedBank}
                value={selectedBank}
                inputProps={{
                  id: 'wr-bank-field',
                  placeholder: t('(please select)'),
                }}
              />
            </FormField>
          ))
        )}

        <Warning>
          <Trans>
            By enabling bank sync, you will be granting Wealth Reader (a third
            party service) read-only access to your accounts. This service is
            not affiliated with Actual. Read Wealth Reader&apos;s{' '}
            <Link
              variant="external"
              to="https://www.wealthreader.com/privacy"
              linkColor="purple"
            >
              Privacy Policy
            </Link>{' '}
            before proceeding.
          </Trans>
        </Warning>

        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <Button
            variant="primary"
            autoFocus
            style={{
              padding: '10px 0',
              fontSize: 15,
              fontWeight: 600,
              flexGrow: 1,
            }}
            onPress={onJump}
            isDisabled={!selectedBank || !country}
          >
            <Trans>Link bank in browser</Trans> &rarr;
          </Button>
        </View>
      </View>
    );
  };

  return (
    <Modal
      name="wealthreader-external-msg"
      onClose={handleClose}
      containerProps={{ style: { width: '30vw' } }}
    >
      {({ state }) => (
        <>
          <ModalHeader
            title={t('Link Your Bank')}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <View>
            <Paragraph style={{ fontSize: 15 }}>
              <Trans>
                To link your bank account, you will be redirected to Wealth
                Reader and then to your bank. Wealth Reader will not be able to
                withdraw funds from your accounts.
              </Trans>
            </Paragraph>

            {error && renderError(error, t)}

            {waiting || isConfigurationLoading ? (
              <View style={{ alignItems: 'center', marginTop: 15 }}>
                <AnimatedLoading
                  color={theme.pageTextDark}
                  style={{ width: 20, height: 20 }}
                />
                <View style={{ marginTop: 10, color: theme.pageText }}>
                  {isConfigurationLoading
                    ? t('Checking Wealth Reader configuration...')
                    : waiting === 'browser'
                      ? t('Waiting on Wealth Reader...')
                      : waiting === 'accounts'
                        ? t('Loading accounts...')
                        : null}
                </View>

                {waiting === 'browser' && (
                  <Link
                    variant="text"
                    onClick={onJump}
                    style={{ marginTop: 10 }}
                  >
                    (
                    <Trans>
                      Account linking not opening in a new tab? Click here
                    </Trans>
                    )
                  </Link>
                )}
              </View>
            ) : isConfigured || isWealthReaderSetupComplete ? (
              renderLinkButton()
            ) : (
              <>
                <Paragraph style={{ color: theme.errorText }}>
                  <Trans>
                    Wealth Reader integration has not yet been configured.
                  </Trans>
                </Paragraph>
                <Button variant="primary" onPress={onWealthReaderInit}>
                  <Trans>Configure Wealth Reader integration</Trans>
                </Button>
              </>
            )}
          </View>
        </>
      )}
    </Modal>
  );
}
