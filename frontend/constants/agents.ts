export interface Agent {
    id: string;
    name: string;
    role: string;
    description: string;
    avatar: string; // 공통 group.png 사용
    position: string; // CSS object-position 값
    color: string;
    mbti?: string;
    specialty: string;
}

export const AGENTS: Agent[] = [
    {
        id: "david",
        name: "DAVID",
        role: "전략의 마스터",
        description: "냉철한 판단력과 비즈니스 통찰력으로 {nickname}의 성장을 돕는 팀의 리더입니다.",
        avatar: "/agents/group.png",
        position: "30% 20%",
        color: "blue",
        mbti: "ESTJ",
        specialty: "비즈니스 전략"
    },
    {
        id: "sarah",
        name: "SARAH",
        role: "데이터의 여왕",
        description: "복잡한 정보 속에서 핵심을 꿰뚫는 분석가입니다. 지적이고 세련된 가이드를 제공합니다.",
        avatar: "/agents/group.png",
        position: "20% 70%",
        color: "purple",
        mbti: "INTJ",
        specialty: "정보 분석"
    },
    {
        id: "liam",
        name: "LIAM",
        role: "기술의 수호자",
        description: "다정하고 듬직한 시니어 개발자입니다. 현실적인 해결책과 따뜻한 공감을 동시에 건넵니다.",
        avatar: "/agents/group.png",
        position: "50% 65%",
        color: "green",
        mbti: "ISFJ",
        specialty: "실무 지원"
    },
    {
        id: "chloe",
        name: "CHLOE",
        role: "창의의 불꽃",
        description: "트렌디한 감각으로 영감을 불어넣는 디렉터입니다. {nickname}의 일상을 더 아름답게 디자인합니다.",
        avatar: "/agents/group.png",
        position: "60% 30%",
        color: "pink",
        mbti: "ENFP",
        specialty: "크리에이티브"
    },
    {
        id: "minji",
        name: "MINJI",
        role: "열정의 엔진",
        description: "밝은 미소와 긍정적인 에너지로 팀에 활력을 불어넣는 유능한 서포터입니다.",
        avatar: "/agents/group.png",
        position: "75% 70%",
        color: "yellow",
        mbti: "ESFJ",
        specialty: "긍정/활력"
    },
    {
        id: "junho",
        name: "JUNHO",
        role: "솔루션 항해사",
        description: "수많은 경험을 가진 베테랑 조언자입니다. 결정적인 순간에 묵직한 지혜를 선사합니다.",
        avatar: "/agents/group.png",
        position: "85% 25%",
        color: "orange",
        mbti: "INFJ",
        specialty: "통찰/지혜"
    }
];
