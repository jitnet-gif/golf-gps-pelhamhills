"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function OnboardingPage() {
    const router = useRouter();
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);

    const [formData, setFormData] = useState({
        name: "",
        mbti: "",
        interests: [] as string[],
        speechStyle: "informal",
        preferred_agent: "david",
    });

    const [interestInput, setInterestInput] = useState("");

    const addInterest = () => {
        if (interestInput && !formData.interests.includes(interestInput)) {
            setFormData({ ...formData, interests: [...formData.interests, interestInput] });
            setInterestInput("");
        }
    };

    const removeInterest = (item: string) => {
        setFormData({ ...formData, interests: formData.interests.filter(i => i !== item) });
    };

    const handleSubmit = async () => {
        setLoading(true);
        try {
            const response = await fetch("/api/v1/onboarding", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(formData),
            });

            if (response.ok) {
                const result = await response.json();
                // 성공 시 환영 메시지와 함께 메인 페이지로 이동 (또는 결과 모달 표시)
                alert(result.initial_greeting);
                router.push("/chat");
            } else {
                alert("온보딩 중 오류가 발생했습니다. 다시 시도해 주세요.");
            }
        } catch (error) {
            console.error("Submission error:", error);
            alert("서버 연결에 실패했습니다.");
        } finally {
            setLoading(false);
        }
    };

    const nextStep = () => setStep(s => s + 1);
    const prevStep = () => setStep(s => s - 1);

    return (
        <div className="min-h-screen bg-bepu-bg flex flex-col items-center justify-center p-6 bg-gradient-to-b from-bepu-bg to-white">
            <div className="max-w-md w-full bg-white rounded-3xl shadow-xl overflow-hidden border border-bepu-coral/20 animate-in fade-in zoom-in duration-500">

                {/* 상단 프로필 이미지 영역 */}
                <div className="bg-bepu-coral p-8 flex flex-col items-center text-white">
                    <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center text-4xl shadow-lg animate-bounce-slow">
                        🐰
                    </div>
                    <h1 className="mt-4 text-2xl font-bold font-outfit">반가워! 난 베푸야</h1>
                    <p className="opacity-90 text-sm mt-1">너에 대해 조금 더 알고 싶어 😊</p>
                </div>

                <div className="p-8">
                    {/* 단계별 입력 폼 */}
                    {step === 1 && (
                        <div className="space-y-6">
                            <div>
                                <label className="block text-sm font-semibold text-bepu-text mb-2">어떻게 불러줄까?</label>
                                <input
                                    type="text"
                                    placeholder="닉네임을 입력해줘"
                                    className="w-full p-4 rounded-2xl border-2 border-bepu-coral/20 focus:border-bepu-coral focus:ring-0 transition-all text-lg"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                />
                            </div>
                            <button
                                disabled={!formData.name}
                                onClick={nextStep}
                                className="w-full bg-bepu-coral hover:bg-red-300 disabled:opacity-50 text-white font-bold py-4 rounded-2xl transition-all shadow-md active:scale-95"
                            >
                                다음으로 가기 ✨
                            </button>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-6">
                            <div>
                                <label className="block text-sm font-semibold text-bepu-text mb-2">너의 MBTI가 뭐야?</label>
                                <div className="grid grid-cols-4 gap-2">
                                    {["ENFP", "INFJ", "INTJ", "ENTP", "ISFJ", "ISTJ", "ESFJ", "ESFP"].map(type => (
                                        <button
                                            key={type}
                                            onClick={() => setFormData({ ...formData, mbti: type })}
                                            className={`p-2 rounded-xl text-xs font-bold border-2 transition-all ${formData.mbti === type ? 'bg-bepu-blue border-bepu-blue text-white' : 'border-gray-100 hover:border-bepu-blue'}`}
                                        >
                                            {type}
                                        </button>
                                    ))}
                                </div>
                                <input
                                    type="text"
                                    placeholder="직접 입력도 가능해"
                                    className="w-full mt-3 p-3 rounded-xl border-2 border-bepu-coral/20 focus:border-bepu-coral transition-all"
                                    value={formData.mbti}
                                    onChange={(e) => setFormData({ ...formData, mbti: e.target.value })}
                                />
                            </div>
                            <div className="flex gap-3">
                                <button onClick={prevStep} className="flex-1 border-2 border-gray-100 py-4 rounded-2xl font-bold text-gray-400">이전</button>
                                <button onClick={nextStep} className="flex-[2] bg-bepu-coral text-white py-4 rounded-2xl font-bold shadow-md">좋아! 다음 ✨</button>
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="space-y-6">
                            <div>
                                <label className="block text-sm font-semibold text-bepu-text mb-2">요즘 관심 있는 게 뭐야? (취미, 공부 등)</label>
                                <div className="flex gap-2 mb-3">
                                    <input
                                        type="text"
                                        placeholder="예: 코딩, 넷플릭스"
                                        className="flex-1 p-3 rounded-xl border-2 border-bepu-coral/20 focus:border-bepu-coral outline-none"
                                        value={interestInput}
                                        onChange={(e) => setInterestInput(e.target.value)}
                                        onKeyPress={(e) => e.key === 'Enter' && addInterest()}
                                    />
                                    <button onClick={addInterest} className="bg-bepu-mint px-4 rounded-xl font-bold text-bepu-text">+</button>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {formData.interests.map(item => (
                                        <span key={item} className="bg-bepu-bg px-3 py-1 rounded-full text-xs flex items-center gap-1 border border-bepu-coral/30">
                                            {item} <button onClick={() => removeInterest(item)} className="text-bepu-coral ml-1 font-bold">×</button>
                                        </span>
                                    ))}
                                </div>
                            </div>
                            <div className="flex gap-3">
                                <button onClick={prevStep} className="flex-1 border-2 border-gray-100 py-4 rounded-2xl font-bold text-gray-400">이전</button>
                                <button
                                    disabled={loading}
                                    onClick={handleSubmit}
                                    className="flex-[2] bg-bepu-mint text-bepu-text py-4 rounded-2xl font-bold shadow-md hover:brightness-95 active:scale-95 transition-all"
                                >
                                    {loading ? "기록 중..." : "준비 완료! 🎉"}
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* 하단 진행도 점 표시 */}
                <div className="flex justify-center pb-8 gap-2">
                    {[1, 2, 3].map(i => (
                        <div key={i} className={`w-2 h-2 rounded-full transition-all duration-300 ${step === i ? 'w-6 bg-bepu-coral' : 'bg-gray-200'}`} />
                    ))}
                </div>
            </div>
        </div>
    );
}
