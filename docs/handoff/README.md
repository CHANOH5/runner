# Handoff — 세션 간 요청서

다른 역할에게 요청·질문·전달할 일이 있으면 이 폴더에 파일을 하나 만든다.

## 파일 이름
`YYYYMMDD-보내는역할-받는역할-주제.md`
예: `20261021-planner-developer-background-location.md`

## 템플릿

```markdown
# [요청 제목]

- From: planner | developer | marketer | orchestrator
- To: planner | developer | marketer | orchestrator
- 종류: 질문 | 요청 | 결정 요청 | 전달
- 관련 ID: F-xxx, S-xxx, P-xxx
- 상태: 열림 | 답변됨 | 종료

## 내용

## 기대하는 결과물 / 답변 형식

## 답변 (받는 쪽이 작성)
```

## 규칙
- 받는 쪽은 "답변" 칸을 채우고 상태를 `답변됨`으로 바꾼다.
- 결정이 필요한 요청은 오케스트레이터가 `decisions.md`에 기록한 뒤 `종료`한다.
