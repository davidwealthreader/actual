import { sendCatch } from '@actual-app/core/platform/client/connection';
import type {
  AccountEntity,
  SyncServerWealthReaderAccount,
} from '@actual-app/core/types/models';
import { t } from 'i18next';

import { pushModal } from '#modals/modalsSlice';
import type { AppDispatch } from '#redux/store';

function _authorize(
  dispatch: AppDispatch,
  {
    onSuccess,
    onClose,
  }: {
    onSuccess: (data: {
      accounts: SyncServerWealthReaderAccount[];
    }) => Promise<void>;
    onClose?: () => void;
  },
) {
  dispatch(
    pushModal({
      modal: {
        name: 'wealthreader-external-msg',
        options: {
          onMoveExternal: async ({ entityCode, onStateReady }) => {
            const redirectUrl = `${window.location.origin}/wealthreader/auth_callback`;
            const resp = await sendCatch('wealthreader-start-auth', {
              entityCode,
              redirectUrl,
            });

            if (resp.error) {
              return {
                error: 'unknown' as const,
                message: resp.error.message,
              };
            }

            const authData = resp.data;

            if (authData?.error) {
              return {
                error: 'unknown' as const,
                message: authData.error,
              };
            }

            const authUrl = authData?.data?.url ?? authData?.url;
            const state = authData?.data?.state ?? authData?.state;
            const nonce = authData?.data?.nonce ?? authData?.nonce;

            if (!authUrl || !state) {
              return {
                error: 'unknown' as const,
                message: t('Missing auth URL or state'),
              };
            }

            localStorage.setItem('wealthreader_auth_state', state);
            if (nonce) {
              localStorage.setItem('wealthreader_auth_nonce', nonce);
            }
            onStateReady?.(state);
            window.open(
              authUrl,
              'wealthreader-auth',
              'width=600,height=700,popup=yes',
            );

            try {
              const pollResp = await sendCatch('wealthreader-poll-auth', {
                state,
              });

              if (pollResp.error) {
                if (pollResp.error.message === 'timeout') {
                  return { error: 'timeout' as const };
                }

                return {
                  error: 'unknown' as const,
                  message: pollResp.error.message,
                };
              }

              const pollData = pollResp.data;
              const pollError = pollData?.data?.error ?? pollData?.error;
              if (pollError) {
                return {
                  error: 'unknown' as const,
                  message:
                    typeof pollError === 'string'
                      ? pollError
                      : String(pollError),
                };
              }

              const payload = pollData?.data ?? pollData ?? {};
              const token: string = payload.token ?? '';
              const institution: string = payload.institution ?? entityCode;
              const rawAccounts = payload.accounts ?? [];

              const accounts: SyncServerWealthReaderAccount[] = rawAccounts.map(
                (account: {
                  account_id: string;
                  name: string;
                  institution?: string;
                  balance?: number;
                  currency?: string;
                  iban?: string;
                }) => ({
                  account_id: account.account_id,
                  name: account.name,
                  institution: account.institution || institution,
                  entity_code: institution,
                  token,
                  balance: account.balance ?? 0,
                  currency: account.currency,
                  iban: account.iban,
                }),
              );

              if (!token) {
                return {
                  error: 'unknown' as const,
                  message: t(
                    'Wealth Reader did not return a token. Register the redirect with tokenize=1.',
                  ),
                };
              }

              return { data: { accounts } };
            } finally {
              if (localStorage.getItem('wealthreader_auth_state') === state) {
                localStorage.removeItem('wealthreader_auth_state');
                localStorage.removeItem('wealthreader_auth_nonce');
              }
            }
          },
          onClose,
          onSuccess,
        },
      },
    }),
  );
}

export async function authorizeBank(
  dispatch: AppDispatch,
  upgradingAccountId?: AccountEntity['id'],
) {
  _authorize(dispatch, {
    onSuccess: async data => {
      dispatch(
        pushModal({
          modal: {
            name: 'select-linked-accounts',
            options: {
              externalAccounts: data.accounts,
              syncSource: 'wealthreader',
              upgradingAccountId,
            },
          },
        }),
      );
    },
  });
}
