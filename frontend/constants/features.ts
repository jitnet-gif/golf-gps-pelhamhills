export interface AdvancedFeature {
    id: string;
    label: string;
    icon: string;
    color: string;
    description: string;
    promptPrefix?: string;
}

export const ADVANCED_FEATURES: AdvancedFeature[] = [
    {
        id: "deep-think",
        label: "Deep Think",
        icon: "🧠",
        color: "blue",
        description: "더 깊고 복잡한 사고를 통해 정교한 답변을 생성합니다.",
        promptPrefix: "[DEEP_THINK] "
    },
    {
        id: "homework",
        label: "Homework",
        icon: "📚",
        color: "purple",
        description: "학습 과제, 리서치 및 지식 습득을 체계적으로 돕습니다.",
        promptPrefix: "[HOMEWORK] "
    },
    {
        id: "ai-creation",
        label: "AI Creation",
        icon: "🎨",
        color: "pink",
        description: "새로운 아이디어, 기획서, 창의적인 컨텐츠를 제작합니다.",
        promptPrefix: "[CREATION] "
    },
    {
        id: "edit-image",
        label: "Edit Image",
        icon: "🖼️",
        color: "cyan",
        description: "이미지 생성 및 편집에 대한 전문적인 가이드를 제공합니다.",
        promptPrefix: "[IMAGE_EDIT] "
    },
    {
        id: "writing",
        label: "Writing",
        icon: "✍️",
        color: "orange",
        description: "에세이, 이메일, 블로그 포스팅 등 글쓰기를 최적화합니다.",
        promptPrefix: "[WRITING] "
    },
    {
        id: "translate",
        label: "Translate",
        icon: "🌐",
        color: "green",
        description: "문맥을 살린 자연스러운 다국어 번역을 수행합니다.",
        promptPrefix: "[TRANSLATE] "
    },
    {
        id: "read-file",
        label: "Read File",
        icon: "📁",
        color: "indigo",
        description: "업로드된 파일의 내용을 분석하고 핵심을 요약합니다.",
        promptPrefix: "[READ_FILE] "
    },
    {
        id: "read-website",
        label: "Read Website",
        icon: "📺",
        color: "red",
        description: "웹사이트 URL이나 유튜브 영상을 분석하여 핵심 정보를 추출합니다.",
        promptPrefix: "[READ_WEB] "
    }
];
