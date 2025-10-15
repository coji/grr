import type { ModalView, PlainTextOption } from 'slack-edge'

export const ILA_LEVEL_OPTIONS: PlainTextOption[] = [
  {
    text: { type: 'plain_text', text: '1 - まあいいか', emoji: true },
    value: '1',
  },
  {
    text: { type: 'plain_text', text: '2 - ちょっとイラッ', emoji: true },
    value: '2',
  },
  {
    text: { type: 'plain_text', text: '3 - うーんイラッ', emoji: true },
    value: '3',
  },
  {
    text: { type: 'plain_text', text: '4 - 結構ムカッ', emoji: true },
    value: '4',
  },
  {
    text: { type: 'plain_text', text: '5 - ブチギレ寸前', emoji: true },
    value: '5',
  },
] as const

export const GRR_MODAL: ModalView = {
  type: 'modal',
  callback_id: 'grr_modal',
  title: { type: 'plain_text', text: 'イライラを記録する' },
  submit: { type: 'plain_text', text: '保存' },
  close: { type: 'plain_text', text: 'キャンセル' },
  blocks: [
    {
      type: 'input',
      block_id: 'level_block',
      label: { type: 'plain_text', text: 'イライラ度 (1〜5)' },
      element: {
        type: 'static_select',
        action_id: 'level',
        options: ILA_LEVEL_OPTIONS,
        initial_option: ILA_LEVEL_OPTIONS[2], // default = 3
        placeholder: {
          type: 'plain_text',
          text: 'イライラ度を選択してください',
        },
      },
    },
    {
      type: 'input',
      block_id: 'text_block',
      label: { type: 'plain_text', text: '内容' },
      element: {
        type: 'plain_text_input',
        action_id: 'text',
        multiline: true,
        placeholder: {
          type: 'plain_text',
          text: 'イライラした内容を入力してください',
        },
      },
    },
  ],
}

export const buildGrrModal = (
  channelId?: string,
  defaultMessage?: string,
): ModalView => {
  return {
    type: 'modal',
    private_metadata: JSON.stringify({ channelId }),
    callback_id: 'grr_modal',
    title: { type: 'plain_text', text: 'イライラを記録する' },
    submit: { type: 'plain_text', text: '保存' },
    close: { type: 'plain_text', text: 'キャンセル' },
    blocks: [
      {
        type: 'input',
        block_id: 'level_block',
        label: { type: 'plain_text', text: 'イライラ度 (1〜5)' },
        element: {
          type: 'static_select',
          action_id: 'level',
          options: ILA_LEVEL_OPTIONS,
          initial_option: ILA_LEVEL_OPTIONS[2], // default = 3
          placeholder: {
            type: 'plain_text',
            text: 'イライラ度を選択してください',
          },
        },
      },
      {
        type: 'input',
        block_id: 'text_block',
        label: { type: 'plain_text', text: '内容' },
        element: {
          type: 'plain_text_input',
          action_id: 'text',
          multiline: true,
          placeholder: {
            type: 'plain_text',
            text: 'イライラした内容を入力してください',
          },
          initial_value: defaultMessage,
        },
      },
    ],
  }
}
